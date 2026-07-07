import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config.js";
import { handleInteraction } from "./interactions.js";
import { handleMessageCreate } from "./messages.js";
import { handleVoiceStateUpdate } from "./voice.js";
import { prisma } from "../db.js";
import { recordActivity } from "../streak/service.js";

export function isGuildAllowed(guildId: string | null | undefined): boolean {
  if (!guildId) return false;

  const allowed = config.ALLOWED_GUILDS || [];
  const testGuild = config.DISCORD_GUILD_ID;

  // If no whitelist and no test guild is set, allow all by default.
  if (allowed.length === 0 && !testGuild) {
    return true;
  }

  if (allowed.includes(guildId)) {
    return true;
  }
  if (testGuild && guildId === testGuild) {
    return true;
  }

  return false;
}

async function syncGuildsToDb(client: Client) {
  try {
    for (const [guildId, guild] of client.guilds.cache) {
      if (isGuildAllowed(guildId)) {
        await prisma.guild.upsert({
          where: { id: guildId },
          create: {
            id: guildId,
            name: guild.name,
            settings: { create: {} }
          },
          update: { name: guild.name }
        });
      }
    }
    console.log("Guilds successfully synchronized with the database.");
  } catch (err) {
    console.error("Failed to sync guilds to database:", err);
  }
}

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
  });

  client.once("ready", async (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);

    // Leave any unauthorized guilds on startup
    for (const [guildId, guild] of readyClient.guilds.cache) {
      if (!isGuildAllowed(guildId)) {
        console.log(`[Security] Leaving unauthorized guild on startup: ${guild.name} (${guildId})`);
        try {
          await guild.leave();
        } catch (err) {
          console.error(`Failed to leave unauthorized guild ${guildId}:`, err);
        }
      }
    }

    // Sync allowed guilds to DB
    await syncGuildsToDb(readyClient);
  });

  client.on("guildCreate", async (guild) => {
    if (!isGuildAllowed(guild.id)) {
      console.log(`[Security] Joined unauthorized guild: ${guild.name} (${guild.id}). Leaving immediately.`);
      try {
        await guild.leave();
      } catch (err) {
        console.error(`Failed to leave unauthorized guild ${guild.id}:`, err);
      }
      return;
    }

    // Upsert into DB
    try {
      await prisma.guild.upsert({
        where: { id: guild.id },
        create: {
          id: guild.id,
          name: guild.name,
          settings: { create: {} }
        },
        update: { name: guild.name }
      });
      console.log(`[Security] Syncing new guild to DB: ${guild.name} (${guild.id})`);
    } catch (err) {
      console.error(`Failed to upsert guild ${guild.id} on join:`, err);
    }
  });

  client.on("messageCreate", (message) => {
    if (!isGuildAllowed(message.guild?.id)) {
      return;
    }
    // Handle ProBot credits restoration transfers
    import("../streak/probot.js").then(({ handleProBotMessage }) => {
      void handleProBotMessage(message);
    });
    handleMessageCreate(message);
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot || !reaction.message.guild || !isGuildAllowed(reaction.message.guild.id)) {
      return;
    }

    // If partial, fetch full message
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        console.error("Failed to fetch partial reaction:", err);
        return;
      }
    }

    try {
      await recordActivity({
        guildId: reaction.message.guild.id,
        guildName: reaction.message.guild.name,
        userId: user.id,
        sourceEventId: `discord:reaction:${reaction.message.id}:${user.id}:${reaction.emoji.name || "emoji"}`,
        type: "REACTION",
        occurredAt: new Date(),
        metadata: {
          channelId: reaction.message.channel.id,
          messageId: reaction.message.id,
          emoji: reaction.emoji.name
        }
      });
    } catch (err) {
      console.error("Failed to record reaction activity:", err);
    }
  });

  client.on("threadCreate", async (thread) => {
    if (!isGuildAllowed(thread.guild.id)) {
      return;
    }

    try {
      const ownerId = thread.ownerId;
      if (!ownerId) return;
      const member = await thread.guild.members.fetch(ownerId).catch(() => null);
      if (member?.user.bot) return;

      await recordActivity({
        guildId: thread.guild.id,
        guildName: thread.guild.name,
        userId: ownerId,
        sourceEventId: `discord:thread:${thread.id}`,
        type: "THREAD",
        occurredAt: thread.createdAt || new Date(),
        metadata: {
          channelId: thread.parentId,
          threadId: thread.id
        }
      });
    } catch (err) {
      console.error("Failed to record thread activity:", err);
    }
  });

  client.on("channelCreate", async (channel) => {
    if (!channel.guild || !isGuildAllowed(channel.guild.id)) {
      return;
    }

    try {
      const name = channel.name.toLowerCase();
      const isTicket = name.includes("ticket") || name.includes("تذكرة") || name.includes("تكت");
      if (isTicket) {
        const { AuditLogEvent } = await import("discord.js");
        const fetchedLogs = await channel.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.ChannelCreate
        }).catch(() => null);
        const logEntry = fetchedLogs?.entries.first();
        const creatorId = logEntry?.executor?.id;
        if (creatorId) {
          const creator = await channel.guild.members.fetch(creatorId).catch(() => null);
          if (creator && !creator.user.bot) {
            await recordActivity({
              guildId: channel.guild.id,
              guildName: channel.guild.name,
              userId: creatorId,
              sourceEventId: `discord:ticket:${channel.id}`,
              type: "TICKET_OPEN",
              occurredAt: new Date(),
              metadata: {
                channelId: channel.id,
                channelName: channel.name
              }
            });
          }
        }
      }
    } catch (err) {
      console.error("Failed to record ticket activity:", err);
    }
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    if (!isGuildAllowed(newState.guild.id)) {
      return;
    }
    handleVoiceStateUpdate(oldState, newState);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!isGuildAllowed(interaction.guildId)) {
      try {
        await interaction.reply({ content: "هذا السيرفر غير مصرح له باستخدام البوت.", ephemeral: true });
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // Record slash command activity
    try {
      await recordActivity({
        guildId: interaction.guildId!,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        sourceEventId: `discord:command:${interaction.id}`,
        type: "COMMAND",
        occurredAt: interaction.createdAt,
        metadata: {
          commandName: interaction.commandName,
          subcommandName: interaction.options.getSubcommand(false) || null
        }
      });
    } catch (err) {
      console.error("Failed to record command activity:", err);
    }

    try {
      await handleInteraction(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "حدث خطأ داخلي.", ephemeral: true });
      } else {
        await interaction.reply({ content: "حدث خطأ داخلي.", ephemeral: true });
      }
    }
  });

  return {
    client,
    login: () => client.login(config.DISCORD_TOKEN)
  };
}


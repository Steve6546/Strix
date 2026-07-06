import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config.js";
import { handleInteraction } from "./interactions.js";
import { handleMessageCreate } from "./messages.js";
import { handleVoiceStateUpdate } from "./voice.js";

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel]
  });

  client.once("ready", (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
  });

  client.on("messageCreate", handleMessageCreate);
  client.on("voiceStateUpdate", handleVoiceStateUpdate);
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
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

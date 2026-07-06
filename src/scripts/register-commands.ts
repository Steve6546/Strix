import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { commandPayload } from "../discord/commands.js";

async function main() {
  if (!config.DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is required to deploy commands.");
  }

  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);

  await rest.put(route, { body: commandPayload });
  console.log(`Registered ${commandPayload.length} commands.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

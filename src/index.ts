import { config } from "./config.js";
import { prisma } from "./db.js";
import { createDiscordClient } from "./discord/client.js";
import { startStreakMaintenance } from "./streak/maintenance.js";
import { createWebServer } from "./web/server.js";

async function main() {
  await prisma.$connect();

  const discord = createDiscordClient();
  const app = createWebServer();

  app.listen(config.WEB_PORT, () => {
    console.log(`Dashboard listening on ${config.PUBLIC_BASE_URL}`);
  });

  startStreakMaintenance();
  await discord.login();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

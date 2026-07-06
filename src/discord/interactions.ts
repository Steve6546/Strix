import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { prisma } from "../db.js";

export async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "هذا الأمر يعمل داخل السيرفر فقط.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "streak") {
    await handleStreak(interaction);
    return;
  }

  if (interaction.commandName === "leaderboard") {
    await handleLeaderboard(interaction);
    return;
  }

  if (interaction.commandName === "streak-settings") {
    await handleSettings(interaction);
  }
}

async function handleStreak(interaction: ChatInputCommandInteraction) {
  const member = interaction.options.getUser("member") ?? interaction.user;
  const streak = await prisma.memberStreak.findUnique({
    where: { guildId_userId: { guildId: interaction.guildId!, userId: member.id } }
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Daily Streak")
    .setDescription(`<@${member.id}>`)
    .addFields(
      { name: "Current", value: String(streak?.currentStreak ?? 0), inline: true },
      { name: "Highest", value: String(streak?.highestStreak ?? 0), inline: true },
      { name: "Completed Days", value: String(streak?.totalCompletedDays ?? 0), inline: true }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  const members = await prisma.memberStreak.findMany({
    where: { guildId: interaction.guildId!, deletedAt: null },
    orderBy: [{ currentStreak: "desc" }, { highestStreak: "desc" }],
    take: 10
  });

  const lines = members.length
    ? members.map((member, index) => `${index + 1}. <@${member.userId}> - ${member.currentStreak} يوم`).join("\n")
    : "لا توجد بيانات بعد.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Daily Streak Leaderboard")
    .setDescription(lines);

  await interaction.reply({ embeds: [embed] });
}

async function handleSettings(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  await prisma.guild.upsert({
    where: { id: interaction.guildId! },
    create: {
      id: interaction.guildId!,
      name: interaction.guild?.name,
      settings: { create: {} }
    },
    update: { name: interaction.guild?.name }
  });

  if (subcommand === "enable" || subcommand === "disable") {
    const enabled = subcommand === "enable";
    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId! },
      data: { enabled }
    });
    await interaction.reply({ content: enabled ? "تم تشغيل النظام." : "تم إيقاف النظام.", ephemeral: true });
    return;
  }

  if (subcommand === "daily-required") {
    const weight = interaction.options.getInteger("weight", true);
    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId! },
      data: { dailyRequiredWeight: weight }
    });
    await interaction.reply({ content: `تم ضبط الحد اليومي إلى ${weight}.`, ephemeral: true });
  }
}

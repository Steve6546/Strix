import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("streak")
    .setDescription("Show your Daily Streak status")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to inspect")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the Daily Streak leaderboard"),
  new SlashCommandBuilder()
    .setName("streak-settings")
    .setDescription("Manage Daily Streak settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable the Daily Streak system")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable the Daily Streak system")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("daily-required")
        .setDescription("Set the required daily activity weight")
        .addIntegerOption((option) =>
          option
            .setName("weight")
            .setDescription("Required activity weight")
            .setMinValue(1)
            .setMaxValue(100000)
            .setRequired(true)
        )
    )
];

export const commandPayload = commandBuilders.map((command) => command.toJSON());

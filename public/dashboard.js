const guildCount = document.querySelector("[data-guild-count]");
const statusText = document.querySelector("[data-status]");
const leaderboard = document.querySelector("[data-leaderboard]");
const settingsForm = document.querySelector("[data-settings-form]");
const guildSelect = document.querySelector("[data-guild-select]");

const state = {
  guilds: []
};

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll("[data-panel]").forEach((panel) => panel.hidden = true);
    button.classList.add("active");
    const panel = document.querySelector(`[data-panel="${button.dataset.view}"]`);
    if (panel) panel.hidden = false;
  });
});

settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const guildId = guildSelect?.value;
  if (!guildId) return;

  const form = new FormData(settingsForm);
  const payload = {
    enabled: form.get("enabled") === "on",
    timezone: String(form.get("timezone") || "Asia/Baghdad"),
    resetTime: String(form.get("resetTime") || "03:00"),
    dailyRequiredWeight: Number(form.get("dailyRequiredWeight") || 1)
  };

  const response = await fetch(`/api/guilds/${guildId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  setStatus(response.ok ? "تم حفظ الإعدادات" : "فشل حفظ الإعدادات");
  if (response.ok) await load();
});

guildSelect?.addEventListener("change", () => {
  renderSelectedGuild();
  loadLeaderboard();
});

load().catch(() => setStatus("تعذر تحميل البيانات"));

async function load() {
  const response = await fetch("/api/guilds");
  if (!response.ok) throw new Error("load failed");
  const data = await response.json();
  state.guilds = data.guilds;
  guildCount.textContent = String(state.guilds.length);
  renderGuildOptions();
  renderSelectedGuild();
  await loadLeaderboard();
  setStatus("متصل");
}

function renderGuildOptions() {
  guildSelect.replaceChildren();
  for (const guild of state.guilds) {
    const option = document.createElement("option");
    option.value = guild.id;
    option.textContent = guild.name || guild.id;
    guildSelect.appendChild(option);
  }
}

function renderSelectedGuild() {
  const guild = state.guilds.find((item) => item.id === guildSelect.value) ?? state.guilds[0];
  if (!guild?.settings || !settingsForm) return;
  settingsForm.elements.namedItem("enabled").checked = guild.settings.enabled;
  settingsForm.elements.namedItem("timezone").value = guild.settings.timezone;
  settingsForm.elements.namedItem("resetTime").value = guild.settings.resetTime;
  settingsForm.elements.namedItem("dailyRequiredWeight").value = guild.settings.dailyRequiredWeight;
}

async function loadLeaderboard() {
  leaderboard.replaceChildren();
  const guildId = guildSelect?.value;
  if (!guildId) {
    const empty = document.createElement("li");
    empty.textContent = "لا توجد سيرفرات بعد";
    leaderboard.appendChild(empty);
    return;
  }

  const response = await fetch(`/api/guilds/${guildId}/leaderboard`);
  if (!response.ok) return;
  const data = await response.json();
  for (const member of data.members) {
    const row = document.createElement("li");
    row.textContent = `${member.userId} - ${member.currentStreak} يوم`;
    leaderboard.appendChild(row);
  }
}

function setStatus(value) {
  statusText.textContent = value;
}

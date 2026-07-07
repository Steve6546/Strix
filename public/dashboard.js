// State
const state = {
  guilds: [],
  selectedGuildId: null,
  activeView: "overview",
  botStatus: { online: false, dbConnected: false },
  logs: [],
  logsCurrentPage: 1,
  logsPageSize: 20
};

// UI Elements
const toastContainer = document.getElementById("toast-container");
const botStatusDot = document.getElementById("bot-status-dot");
const botStatusText = document.getElementById("bot-status-text");
const dataStatusDot = document.getElementById("data-status-dot");
const dataStatusText = document.getElementById("data-status-text");
const btnRetryLoad = document.getElementById("btn-retry-load");

const topbarGuildIndicator = document.getElementById("topbar-guild-indicator");
const topbarGuildIcon = document.getElementById("topbar-guild-icon");
const topbarGuildName = document.getElementById("topbar-guild-name");

const guildSelect = document.getElementById("guild-select-element");
const guildCount = document.querySelector("[data-guild-count]");
const dbStatusBadge = document.getElementById("db-status-badge");

const settingsForm = document.querySelector("[data-settings-form]");
const activityForm = document.querySelector("[data-activity-form]");
const voiceForm = document.querySelector("[data-voice-form]");
const messagesForm = document.querySelector("[data-messages-form]");
const probotForm = document.querySelector("[data-probot-form]");
const addRoleForm = document.querySelector("[data-add-role-form]");
const addRewardForm = document.querySelector("[data-add-reward-form]");
const leaderboardSettingsForm = document.getElementById("leaderboard-settings-form");

const activityContainer = document.getElementById("activity-weights-container");
const rolesList = document.getElementById("roles-list");
const rewardsList = document.getElementById("rewards-list");
const backupsTableBody = document.getElementById("backups-table-body");
const logsTableBody = document.getElementById("logs-table-body");
const leaderboardPreviewList = document.getElementById("leaderboard-preview-list");

const discordRolesDropdown = document.getElementById("discord-roles-dropdown");
const discordChannelsDropdown = document.getElementById("discord-channels-dropdown");
const roleHierarchyWarning = document.getElementById("role-hierarchy-warning");

const btnCreateBackup = document.getElementById("btn-create-backup");
const backupFileUploader = document.getElementById("backup-file-uploader");
const btnPublishLeaderboard = document.getElementById("btn-publish-leaderboard");
const btnExportLogs = document.getElementById("btn-export-logs");

const logFilterAction = document.getElementById("log-filter-action");
const logFilterUser = document.getElementById("log-filter-user");

// Toast Notifications Helper
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  // Clean up element after animation
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Inline Validation Helper
function validateNumberInput(input, min, max) {
  const val = Number(input.value);
  if (isNaN(val) || val < min || val > max) {
    input.classList.add("input-error");
    return false;
  }
  input.classList.remove("input-error");
  return true;
}

// Enable/Disable Dashboard Panels
function togglePanelsState(enabled) {
  const fieldsets = document.querySelectorAll(".form-fieldset");
  fieldsets.forEach(f => {
    f.disabled = !enabled;
  });
}

// Bot Connection Check
async function checkBotStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    state.botStatus = { online: data.botOnline, dbConnected: data.dbConnected };
    
    // Update Bot Status Indicator
    if (data.botOnline && data.botUser) {
      botStatusDot.className = "dot online";
      botStatusText.textContent = `البوت متصل (${data.botUser.username})`;
    } else {
      botStatusDot.className = "dot error";
      botStatusText.textContent = "البوت غير متصل بالديسكورد";
    }
    
    // Update DB Status badge in Overview card
    if (dbStatusBadge) {
      dbStatusBadge.textContent = data.dbConnected ? "متصلة وسليمة" : "فشل الاتصال";
      dbStatusBadge.className = data.dbConnected ? "value status-ok" : "value status-error";
    }
  } catch (err) {
    botStatusDot.className = "dot error";
    botStatusText.textContent = "تعذر الاتصال بالخادم";
    if (dbStatusBadge) {
      dbStatusBadge.textContent = "تعذر الاتصال بالخادم";
      dbStatusBadge.className = "value status-error";
    }
  }
}

// Server Data Loading Status
function setDataLoadingStatus(status, text) {
  dataStatusDot.className = `dot ${status}`;
  dataStatusText.textContent = text;
  
  if (status === "error") {
    btnRetryLoad.classList.remove("hidden");
    togglePanelsState(false);
  } else if (status === "online") {
    btnRetryLoad.classList.add("hidden");
    togglePanelsState(!!state.selectedGuildId);
  } else {
    btnRetryLoad.classList.add("hidden");
    togglePanelsState(false);
  }
}

// Navigation Tabs Setup
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll("[data-panel]").forEach((panel) => panel.hidden = true);
    
    button.classList.add("active");
    state.activeView = button.dataset.view;
    
    const panel = document.querySelector(`[data-panel="${state.activeView}"]`);
    if (panel) {
      panel.hidden = false;
      if (state.selectedGuildId) {
        loadPanelData(state.activeView);
      }
    }
  });
});

// Load Panel Specific Data
async function loadPanelData(view) {
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  try {
    if (view === "roles") {
      await loadRoles(guildId);
      await fetchDiscordRoles(guildId);
    }
    if (view === "rewards") {
      await loadRewards(guildId);
    }
    if (view === "backup") {
      await loadBackups(guildId);
    }
    if (view === "logs") {
      await loadLogs(guildId);
    }
    if (view === "leaderboard") {
      await fetchDiscordChannels(guildId);
      await loadLeaderboard(guildId);
    }
  } catch (err) {
    showToast("تعذر تحميل بيانات القسم الحالي", "error");
  }
}

// Initial Boot Loader
async function boot() {
  await checkBotStatus();
  // Poll bot status every 5 seconds
  setInterval(checkBotStatus, 5000);
  
  setDataLoadingStatus("loading", "جاري تحميل قائمة السيرفرات...");
  
  try {
    const res = await fetch("/api/guilds");
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.guilds = data.guilds;
    guildCount.textContent = String(state.guilds.length);
    
    populateGuildDropdown();
    
    // Auto-select saved guild
    const savedGuildId = localStorage.getItem("selected_guild_id");
    if (savedGuildId && state.guilds.some(g => g.id === savedGuildId)) {
      guildSelect.value = savedGuildId;
      selectGuild(savedGuildId);
    } else if (state.guilds.length > 0) {
      // Don't auto-select first one, let them select or select first if preferred
      guildSelect.value = state.guilds[0].id;
      selectGuild(state.guilds[0].id);
    } else {
      setDataLoadingStatus("error", "لا توجد سيرفرات مضافة للبوت");
    }
  } catch (err) {
    setDataLoadingStatus("error", "فشل تحميل البيانات من السيرفر");
  }
}

// Populate Guild Select Dropdown
function populateGuildDropdown() {
  // Clear but keep placeholder
  guildSelect.innerHTML = `<option value="">-- اختر سيرفراً لإدارته --</option>`;
  
  state.guilds.forEach(guild => {
    const option = document.createElement("option");
    option.value = guild.id;
    option.textContent = guild.name || guild.id;
    guildSelect.appendChild(option);
  });
}

// Select Guild Logic
function selectGuild(guildId) {
  if (!guildId) {
    state.selectedGuildId = null;
    localStorage.removeItem("selected_guild_id");
    topbarGuildName.textContent = "لم يتم اختيار سيرفر";
    topbarGuildIcon.classList.add("hidden");
    togglePanelsState(false);
    setDataLoadingStatus("online", "يرجى اختيار سيرفر لبدء الإدارة");
    return;
  }
  
  state.selectedGuildId = guildId;
  localStorage.setItem("selected_guild_id", guildId);
  
  const guild = state.guilds.find(g => g.id === guildId);
  if (guild) {
    topbarGuildName.textContent = guild.name || guildId;
    if (guild.iconUrl) {
      topbarGuildIcon.src = guild.iconUrl;
      topbarGuildIcon.classList.remove("hidden");
    } else {
      topbarGuildIcon.classList.add("hidden");
    }
  }
  
  // Enable panels
  togglePanelsState(true);
  setDataLoadingStatus("online", "متصل وجاهز");
  
  // Render Settings values of the selected guild
  renderGuildSettings(guild);
  
  // Load active view data
  loadPanelData(state.activeView);
}

// Handle Guild Selection Dropdown Change
guildSelect.addEventListener("change", (e) => {
  selectGuild(e.target.value);
});

// Retry Data Loading
btnRetryLoad.addEventListener("click", () => {
  boot();
});

// Render Guild Settings in forms
function renderGuildSettings(guild) {
  if (!guild?.settings) return;
  const s = guild.settings;

  // General Settings
  if (settingsForm) {
    settingsForm.elements.namedItem("enabled").checked = !!s.enabled;
    settingsForm.elements.namedItem("locale").value = s.locale || "ar";
    settingsForm.elements.namedItem("timezone").value = s.timezone || "Asia/Baghdad";
    settingsForm.elements.namedItem("mode").value = s.mode || "CALENDAR_RESET";
    settingsForm.elements.namedItem("resetTime").value = s.resetTime || "03:00";
    settingsForm.elements.namedItem("graceMinutes").value = s.graceMinutes !== undefined ? s.graceMinutes : 60;
  }

  // Activities weight container
  if (activityContainer) {
    activityContainer.innerHTML = "";
    
    // Set dailyRequiredWeight in the activity form
    if (activityForm) {
      activityForm.elements.namedItem("dailyRequiredWeight").value = s.dailyRequiredWeight || 1;
    }
    
    const weights = s.activityWeights || {};
    const activityTypes = [
      { key: "MESSAGE", name: "الرسائل النصية", icon: "💬" },
      { key: "IMAGE", name: "الصور والمرفقات المرئية", icon: "🖼️" },
      { key: "VIDEO", name: "الفيديوهات واللقطات", icon: "🎥" },
      { key: "FILE", name: "المستندات والملفات المرفقة", icon: "📁" },
      { key: "STICKER", name: "الملصقات (Stickers)", icon: "🏷️" },
      { key: "REACTION", name: "إضافة التفاعل (Reaction)", icon: "👍" },
      { key: "VOICE", name: "المحادثات الصوتية (Voice)", icon: "🔊" },
      { key: "VOICE_STREAM", name: "البث داخل الفويس (Go Live)", icon: "📡" },
      { key: "SCREEN_SHARE", name: "مشاركة الشاشة (Screen Share)", icon: "🖥️" },
      { key: "THREAD", name: "إنشاء المواضيع (Thread)", icon: "🧵" },
      { key: "REPLY", name: "الردود على الرسائل (Replies)", icon: "↩️" },
      { key: "COMMAND", name: "استخدام الأوامر (Slash Commands)", icon: "🤖" },
      { key: "BOT_INTERACTION", name: "التفاعل مع البوتات", icon: "🤝" },
      { key: "TICKET_OPEN", name: "فتح تذاكر الدعم (Tickets)", icon: "🎫" },
      { key: "CUSTOM", name: "الأنشطة المخصصة", icon: "🌟" }
    ];
    
    activityTypes.forEach(act => {
      const val = weights[act.key] !== undefined ? weights[act.key] : 0;
      const isEnabled = val > 0;
      
      const row = document.createElement("div");
      row.className = `activity-row ${!isEnabled ? "disabled" : ""}`;
      
      row.innerHTML = `
        <span class="activity-icon">${act.icon}</span>
        <span class="activity-name">${act.name}</span>
        <label class="checkbox" style="min-height: auto; margin-bottom: 0;">
          <input type="checkbox" class="activity-toggle" ${isEnabled ? "checked" : ""} /> تفعيل
        </label>
        <input type="number" name="${act.key}" class="activity-weight-input" value="${val}" min="0" max="10000" ${!isEnabled ? "disabled" : ""} style="width: 100px; text-align: center;" />
      `;
      
      // Toggle listener
      const toggle = row.querySelector(".activity-toggle");
      const weightInput = row.querySelector(".activity-weight-input");
      
      toggle.addEventListener("change", (e) => {
        const checked = e.target.checked;
        weightInput.disabled = !checked;
        if (checked) {
          row.classList.remove("disabled");
          if (Number(weightInput.value) <= 0) {
            weightInput.value = 1; // Default back to 1 if enabled
          }
        } else {
          row.classList.add("disabled");
          weightInput.value = 0;
        }
      });
      
      activityContainer.appendChild(row);
    });
  }

  // Voice Rules Form
  if (voiceForm && s.voiceRules) {
    const r = s.voiceRules;
    voiceForm.elements.namedItem("minMinutes").value = r.minMinutes || 10;
    voiceForm.elements.namedItem("ignoreMuted").checked = !!r.ignoreMuted;
    voiceForm.elements.namedItem("ignoreDeafened").checked = !!r.ignoreDeafened;
    voiceForm.elements.namedItem("ignoreAFK").checked = !!r.ignoreAFK;
    voiceForm.elements.namedItem("realTimeOnly").checked = !!r.realTimeOnly;
    voiceForm.elements.namedItem("limitOneSessionPerDay").checked = !!r.limitOneSessionPerDay;
  }

  // Messages Rules Form
  if (messagesForm && s.messageRules) {
    const r = s.messageRules;
    messagesForm.elements.namedItem("minLength").value = r.minLength || 2;
    messagesForm.elements.namedItem("ignoreBots").checked = !!r.ignoreBots;
    messagesForm.elements.namedItem("ignoreRepeated").checked = !!r.ignoreRepeated;
    messagesForm.elements.namedItem("ignoreSpam").checked = !!r.ignoreSpam;
    messagesForm.elements.namedItem("ignoreDeleted").checked = !!r.ignoreDeleted;
    messagesForm.elements.namedItem("ignoreEdited").checked = !!r.ignoreEdited;
  }

  // ProBot Settings Form
  if (probotForm) {
    probotForm.elements.namedItem("restoreEnabled").checked = !!s.restoreEnabled;
    probotForm.elements.namedItem("restorePrice").value = s.restorePrice !== undefined ? s.restorePrice : 1000;
    probotForm.elements.namedItem("restoreRecipientId").value = s.restoreRecipientId || "";
    probotForm.elements.namedItem("restoreTimeoutHours").value = s.restoreTimeoutHours || 24;
  }
}

// ── FORM SUBMIT EVENTS ──

// General Settings
settingsForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(settingsForm);
  
  // Validation
  const graceMinutesInput = settingsForm.querySelector("input[name='graceMinutes']");
  if (!validateNumberInput(graceMinutesInput, 0, 1440)) {
    showToast("فترة السماح يجب أن تكون بين 0 و 1440 دقيقة", "error");
    return;
  }

  const payload = {
    enabled: form.get("enabled") === "on",
    locale: String(form.get("locale")),
    timezone: String(form.get("timezone")),
    mode: String(form.get("mode")),
    resetTime: String(form.get("resetTime")),
    graceMinutes: Number(form.get("graceMinutes"))
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast("تم حفظ الإعدادات العامة بنجاح!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر حفظ الإعدادات العامة", "error");
  }
});

// Activity Weights & Daily Minimum Required
activityForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const dailyWeightInput = activityForm.querySelector("input[name='dailyRequiredWeight']");
  if (!validateNumberInput(dailyWeightInput, 1, 100000)) {
    showToast("الحد الأدنى للأوزان اليومية يجب أن يكون بين 1 و 100,000", "error");
    return;
  }

  const activityWeights = {};
  activityForm.querySelectorAll(".activity-weight-input").forEach(input => {
    activityWeights[input.name] = Number(input.value);
  });

  const payload = {
    dailyRequiredWeight: Number(dailyWeightInput.value),
    activityWeights
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تم حفظ أوزان الأنشطة بنجاح!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر حفظ أوزان الأنشطة", "error");
  }
});

// Voice Rules
voiceForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(voiceForm);
  const minMinutesInput = voiceForm.querySelector("input[name='minMinutes']");
  if (!validateNumberInput(minMinutesInput, 1, 1440)) {
    showToast("الحد الأدنى لوقت الحضور يجب أن يكون بين 1 و 1440 دقيقة", "error");
    return;
  }

  const payload = {
    voiceRules: {
      minMinutes: Number(form.get("minMinutes")),
      ignoreMuted: form.get("ignoreMuted") === "on",
      ignoreDeafened: form.get("ignoreDeafened") === "on",
      ignoreAFK: form.get("ignoreAFK") === "on",
      realTimeOnly: form.get("realTimeOnly") === "on",
      limitOneSessionPerDay: form.get("limitOneSessionPerDay") === "on"
    }
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تم حفظ إعدادات الصوت بنجاح!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر حفظ إعدادات الصوت", "error");
  }
});

// Messages Rules
messagesForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(messagesForm);
  const minLengthInput = messagesForm.querySelector("input[name='minLength']");
  if (!validateNumberInput(minLengthInput, 1, 2000)) {
    showToast("أقل عدد حروف للرسالة يجب أن يكون بين 1 و 2000 حرفاً", "error");
    return;
  }

  const payload = {
    messageRules: {
      minLength: Number(form.get("minLength")),
      ignoreBots: form.get("ignoreBots") === "on",
      ignoreRepeated: form.get("ignoreRepeated") === "on",
      ignoreSpam: form.get("ignoreSpam") === "on",
      ignoreDeleted: form.get("ignoreDeleted") === "on",
      ignoreEdited: form.get("ignoreEdited") === "on"
    }
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تم حفظ إعدادات الرسائل بنجاح!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر حفظ إعدادات الرسائل", "error");
  }
});

// ProBot Credits Restore Settings
probotForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(probotForm);
  
  // Validation
  const restorePriceInput = probotForm.querySelector("input[name='restorePrice']");
  const restoreTimeoutInput = probotForm.querySelector("input[name='restoreTimeoutHours']");
  const restoreRecipientIdInput = probotForm.querySelector("input[name='restoreRecipientId']");

  if (!validateNumberInput(restorePriceInput, 0, 10000000)) {
    showToast("سعر الاسترجاع يجب أن يكون بين 0 و 10,000,000", "error");
    return;
  }
  if (!validateNumberInput(restoreTimeoutInput, 1, 168)) {
    showToast("المهلة الزمنية يجب أن تكون بين 1 و 168 ساعة", "error");
    return;
  }
  
  const recipientId = String(form.get("restoreRecipientId")).trim();
  if (!/^\d{17,20}$/.test(recipientId)) {
    restoreRecipientIdInput.classList.add("input-error");
    showToast("معرّف ديسكورد المستلم غير صالح (أرقام فقط بطول 17-20)", "error");
    return;
  }
  restoreRecipientIdInput.classList.remove("input-error");

  const payload = {
    restoreEnabled: form.get("restoreEnabled") === "on",
    restorePrice: Number(form.get("restorePrice")),
    restoreRecipientId: recipientId,
    restoreTimeoutHours: Number(form.get("restoreTimeoutHours"))
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تم حفظ إعدادات ProBot بنجاح!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر حفظ إعدادات ProBot", "error");
  }
});

// Update settings inside local guilds state cache
function updateLocalGuildCache(guildId, updatedSettings) {
  const guildIndex = state.guilds.findIndex(g => g.id === guildId);
  if (guildIndex !== -1) {
    state.guilds[guildIndex].settings = updatedSettings;
  }
}

// ── ROLES MANAGEMENT ──

// Fetch Discord roles list
async function fetchDiscordRoles(guildId) {
  try {
    const res = await fetch(`/api/guilds/${guildId}/discord-roles`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    discordRolesDropdown.innerHTML = `<option value="">-- اختر رتبة --</option>`;
    
    data.roles.forEach(role => {
      const option = document.createElement("option");
      option.value = role.id;
      option.textContent = role.name;
      if (role.isHigherThanBot) {
        option.textContent += " (⚠️ رتبة أعلى من البوت)";
      }
      discordRolesDropdown.appendChild(option);
    });
    
    // Check if warning banner needs to be shown globally
    const hasHigherRoles = data.roles.some(r => r.isHigherThanBot);
    roleHierarchyWarning.style.display = hasHigherRoles ? "block" : "none";
  } catch {
    discordRolesDropdown.innerHTML = `<option value="">-- فشل جلب الرتب --</option>`;
  }
}

// Load Streak Roles list
async function loadRoles(guildId) {
  rolesList.innerHTML = `<div class="skeleton"></div>`;
  try {
    const res = await fetch(`/api/guilds/${guildId}/roles`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    rolesList.innerHTML = "";
    if (data.roles.length === 0) {
      rolesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎖️</div>
          <div class="empty-text">لا توجد أي رتب ستريك مضافة حالياً.</div>
        </div>
      `;
      return;
    }

    data.roles.forEach(r => {
      const li = document.createElement("li");
      
      const roleText = document.createElement("span");
      roleText.innerHTML = `الرتبة: <strong class="code">${r.roleId}</strong> | الأيام: <strong>${r.requiredDays}</strong> | أولوية: <strong>${r.priority}</strong>`;
      li.appendChild(roleText);

      // Check if delete action is taken
      const btn = document.createElement("button");
      btn.textContent = "حذف 🗑️";
      btn.className = "danger btn-sm";
      btn.onclick = async () => {
        if (confirm("هل أنت متأكد من حذف هذه الرتبة؟")) {
          const delRes = await fetch(`/api/guilds/${guildId}/roles/${r.roleId}`, { method: "DELETE" });
          if (delRes.ok) {
            showToast("تم حذف رتبة الستريك بنجاح.");
            await loadRoles(guildId);
            await fetchDiscordRoles(guildId);
          } else {
            showToast("فشل حذف الرتبة", "error");
          }
        }
      };
      
      li.appendChild(btn);
      rolesList.appendChild(li);
    });
  } catch {
    rolesList.innerHTML = `<div class="error-banner">فشل في تحميل الرتب الحالية</div>`;
  }
}

// Add New Streak Role
addRoleForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(addRoleForm);
  const requiredDaysInput = addRoleForm.querySelector("input[name='requiredDays']");
  const priorityInput = addRoleForm.querySelector("input[name='priority']");

  if (!validateNumberInput(requiredDaysInput, 1, 10000)) {
    showToast("عدد الأيام يجب أن يكون 1 أو أكثر", "error");
    return;
  }
  if (!validateNumberInput(priorityInput, -10000, 10000)) {
    showToast("الأولوية يجب أن تكون قيمة رقمية صالحة", "error");
    return;
  }

  const payload = {
    roleId: form.get("roleId"),
    requiredDays: Number(form.get("requiredDays")),
    removeOnBreak: form.get("removeOnBreak") === "on",
    allowStacking: form.get("allowStacking") === "on",
    priority: Number(form.get("priority") || 0)
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تمت إضافة رتبة ستريك بنجاح!");
      addRoleForm.reset();
      await loadRoles(guildId);
      await fetchDiscordRoles(guildId);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر إضافة رتبة ستريك", "error");
  }
});

// ── REWARDS MANAGEMENT ──

// Load Rewards List
async function loadRewards(guildId) {
  rewardsList.innerHTML = `<div class="skeleton"></div>`;
  try {
    const res = await fetch(`/api/guilds/${guildId}/rewards`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    rewardsList.innerHTML = "";
    if (data.rewards.length === 0) {
      rewardsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎁</div>
          <div class="empty-text">لم يتم إضافة أي مكافأة لهذا السيرفر بعد.</div>
        </div>
      `;
      return;
    }

    data.rewards.forEach(r => {
      const li = document.createElement("li");
      
      const rewardText = document.createElement("span");
      let friendlyType = r.type;
      if (r.type === "ROLE") friendlyType = "منح رتبة";
      if (r.type === "POINTS") friendlyType = "منح نقاط";
      if (r.type === "XP") friendlyType = "نقاط خبرة";
      if (r.type === "CUSTOM_COMMAND") friendlyType = "أمر مخصص";

      rewardText.innerHTML = `الاسم: <strong>${r.name}</strong> | النوع: <strong>${friendlyType}</strong> | الأيام: <strong>${r.requiredDays}</strong>`;
      li.appendChild(rewardText);

      const btn = document.createElement("button");
      btn.textContent = "حذف 🗑️";
      btn.className = "danger btn-sm";
      btn.onclick = async () => {
        if (confirm("هل تريد حذف هذه المكافأة التلقائية؟")) {
          const delRes = await fetch(`/api/guilds/${guildId}/rewards/${r.id}`, { method: "DELETE" });
          if (delRes.ok) {
            showToast("تم حذف المكافأة بنجاح.");
            await loadRewards(guildId);
          } else {
            showToast("فشل حذف المكافأة", "error");
          }
        }
      };
      
      li.appendChild(btn);
      rewardsList.appendChild(li);
    });
  } catch {
    rewardsList.innerHTML = `<div class="error-banner">تعذر تحميل قائمة المكافآت</div>`;
  }
}

// Add New Reward
addRewardForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(addRewardForm);
  const requiredDaysInput = addRewardForm.querySelector("input[name='requiredDays']");

  if (!validateNumberInput(requiredDaysInput, 1, 10000)) {
    showToast("عدد الأيام المطلوبة يجب أن يكون 1 أو أكثر", "error");
    return;
  }

  const payload = {
    name: String(form.get("name")),
    type: String(form.get("type")),
    requiredDays: Number(form.get("requiredDays")),
    repeatable: form.get("repeatable") === "on",
    payload: {}
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/rewards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تمت إضافة المكافأة التلقائية بنجاح!");
      addRewardForm.reset();
      await loadRewards(guildId);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر إضافة المكافأة التلقائية", "error");
  }
});

// ── LEADERBOARD PREVIEW & PUBLISH ──

// Fetch Discord text channels
async function fetchDiscordChannels(guildId) {
  try {
    const res = await fetch(`/api/guilds/${guildId}/discord-channels`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    discordChannelsDropdown.innerHTML = `<option value="">-- اختر القناة النصية --</option>`;
    data.channels.forEach(ch => {
      const option = document.createElement("option");
      option.value = ch.id;
      option.textContent = `# ${ch.name}`;
      discordChannelsDropdown.appendChild(option);
    });
  } catch {
    discordChannelsDropdown.innerHTML = `<option value="">-- فشل جلب القنوات --</option>`;
  }
}

// Load Leaderboard data & settings
async function loadLeaderboard(guildId) {
  leaderboardPreviewList.innerHTML = `<div class="skeleton"></div>`;
  try {
    const res = await fetch(`/api/guilds/${guildId}/leaderboard`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    // Fill form settings
    const settings = data.settings || {};
    leaderboardSettingsForm.elements.namedItem("limit").value = settings.limit || 25;
    leaderboardSettingsForm.elements.namedItem("excludeBots").checked = settings.excludeBots !== false;
    leaderboardSettingsForm.elements.namedItem("channelId").value = settings.channelId || "";
    leaderboardSettingsForm.elements.namedItem("autoUpdate").checked = !!settings.autoUpdate;
    leaderboardSettingsForm.elements.namedItem("intervalMinutes").value = settings.intervalMinutes || 60;
    
    // Render Live Preview Embed list
    renderLeaderboardPreview(data.members);
  } catch {
    leaderboardPreviewList.innerHTML = `<li>تعذر تحميل المعاينة الحية.</li>`;
  }
}

// Render Leaderboard Preview List
function renderLeaderboardPreview(members) {
  leaderboardPreviewList.innerHTML = "";
  if (members.length === 0) {
    leaderboardPreviewList.innerHTML = `<li>لا توجد إحصائيات أعضاء حالياً.</li>`;
    return;
  }
  
  members.forEach((m, idx) => {
    const li = document.createElement("li");
    li.className = "leaderboard-entry";
    li.innerHTML = `
      <span class="leaderboard-rank">#${idx + 1}</span>
      <span>العضو: <strong class="code">${m.userId}</strong> — الستريك الحالي: <strong>${m.currentStreak} يوم</strong> (أعلى: ${m.highestStreak})</span>
    `;
    leaderboardPreviewList.appendChild(li);
  });
}

// Save Leaderboard Settings
leaderboardSettingsForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const form = new FormData(leaderboardSettingsForm);
  const limitInput = leaderboardSettingsForm.querySelector("input[name='limit']");
  const intervalInput = leaderboardSettingsForm.querySelector("input[name='intervalMinutes']");

  if (!validateNumberInput(limitInput, 1, 100)) {
    showToast("عدد الأعضاء يجب أن يكون بين 1 و 100", "error");
    return;
  }
  if (!validateNumberInput(intervalInput, 5, 1440)) {
    showToast("وقت التحديث التلقائي يجب أن يكون 5 دقائق كحد أدنى", "error");
    return;
  }

  const payload = {
    leaderboardSettings: {
      limit: Number(form.get("limit")),
      excludeBots: form.get("excludeBots") === "on",
      channelId: String(form.get("channelId")),
      autoUpdate: form.get("autoUpdate") === "on",
      intervalMinutes: Number(form.get("intervalMinutes"))
    }
  };

  try {
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("تم حفظ إعدادات لوحة المتصدرين!");
      const data = await res.json();
      updateLocalGuildCache(guildId, data.settings);
      await loadLeaderboard(guildId);
    } else {
      throw new Error();
    }
  } catch {
    showToast("فشل حفظ إعدادات المتصدرين", "error");
  }
});

// Publish Leaderboard Embed Button
btnPublishLeaderboard?.addEventListener("click", async () => {
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  setStatusLoadingState(true, "جاري نشر لوحة المتصدرين بالديسكورد...");
  
  try {
    const res = await fetch(`/api/guilds/${guildId}/leaderboard/publish`, { method: "POST" });
    const data = await res.json();
    
    if (res.ok) {
      showToast("تم نشر وتحديث لوحة المتصدرين بالديسكورد بنجاح! 🚀");
      await loadLeaderboard(guildId);
    } else {
      throw new Error(data.error || "خطأ أثناء النشر");
    }
  } catch (err) {
    showToast(err.message || "تعذر نشر لوحة المتصدرين", "error");
  } finally {
    setStatusLoadingState(false);
  }
});

function setStatusLoadingState(isLoading, text = "") {
  if (isLoading) {
    dataStatusDot.className = "dot loading";
    dataStatusText.textContent = text;
  } else {
    dataStatusDot.className = "dot online";
    dataStatusText.textContent = "متصل وجاهز";
  }
}

// ── BACKUPS MANAGEMENT ──

// Load Backups List Table
async function loadBackups(guildId) {
  backupsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">جاري تحميل النسخ الاحتياطية...</td></tr>`;
  try {
    const res = await fetch(`/api/guilds/${guildId}/backups`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    backupsTableBody.innerHTML = "";
    if (data.backups.length === 0) {
      backupsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted);">لا توجد أي نسخة احتياطية محفوظة لهذا السيرفر.</td></tr>`;
      return;
    }

    data.backups.forEach(b => {
      const tr = document.createElement("tr");
      
      const kbSize = (Number(b.sizeBytes) / 1024).toFixed(2);
      const isFull = b.kind === "FULL";
      const badgeClass = isFull ? "badge-full" : "badge-partial";
      const badgeText = isFull ? "كاملة للنظام" : "جزئية للسيرفر";
      
      const healthBadge = b.isHealthy
        ? `<span class="badge badge-success">سليمة ✅</span>`
        : `<span class="badge badge-danger">تالفة ⚠️</span>`;
      
      tr.innerHTML = `
        <td style="font-weight: 600;">${new Date(b.createdAt).toLocaleString()}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td>${kbSize} KB</td>
        <td>${healthBadge} <span class="badge badge-checksum" title="${b.checksum}">${b.checksum.slice(0, 10)}...</span></td>
        <td>
          <button class="primary btn-sm btn-restore-backup" data-id="${b.id}">استعادة 📂</button>
          <a href="/api/backups/${b.id}/download" class="secondary btn-sm" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; height: 30px;">تحميل 📥</a>
          <button class="danger btn-sm btn-delete-backup" data-id="${b.id}">حذف 🗑️</button>
        </td>
      `;
      
      // Restore click handler
      tr.querySelector(".btn-restore-backup").addEventListener("click", async () => {
        if (confirm("⚠️ تحذير: استعادة هذه النسخة سيمحو التغييرات الحالية ويستبدلها بالنسخة القديمة. هل أنت متأكد من المتابعة؟")) {
          setStatusLoadingState(true, "جاري استعادة النسخة الاحتياطية وتحديث الهيكل...");
          try {
            const rRes = await fetch(`/api/backups/${b.id}/restore`, { method: "POST" });
            if (rRes.ok) {
              showToast("تمت استعادة النسخة الاحتياطية وتحديث البيانات بالكامل!");
              await boot();
            } else {
              throw new Error();
            }
          } catch {
            showToast("فشلت عملية استعادة النسخة الاحتياطية", "error");
          } finally {
            setStatusLoadingState(false);
          }
        }
      });

      // Delete handler
      tr.querySelector(".btn-delete-backup").addEventListener("click", async () => {
        if (confirm("هل تريد حذف ملف هذه النسخة الاحتياطية نهائياً؟")) {
          try {
            const dRes = await fetch(`/api/backups/${b.id}`, { method: "DELETE" });
            if (dRes.ok) {
              showToast("تم حذف النسخة الاحتياطية نهائياً.");
              await loadBackups(guildId);
            } else {
              throw new Error();
            }
          } catch {
            showToast("فشل حذف النسخة الاحتياطية", "error");
          }
        }
      });
      
      backupsTableBody.appendChild(tr);
    });
  } catch {
    backupsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger);">فشل تحميل جدول النسخ الاحتياطية.</td></tr>`;
  }
}

// Create New Backup
btnCreateBackup?.addEventListener("click", async () => {
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  setStatusLoadingState(true, "جاري سحب الجداول وإنشاء نسخة JSON...");
  try {
    const res = await fetch(`/api/guilds/${guildId}/backups`, { method: "POST" });
    if (res.ok) {
      showToast("تم إنشاء نسخة احتياطية جديدة وحفظها بنجاح!");
      await loadBackups(guildId);
    } else {
      throw new Error();
    }
  } catch {
    showToast("تعذر إنشاء نسخة احتياطية", "error");
  } finally {
    setStatusLoadingState(false);
  }
});

// Import External Backup JSON File
backupFileUploader?.addEventListener("change", async (e) => {
  const guildId = state.selectedGuildId;
  if (!guildId) return;

  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsedJson = JSON.parse(event.target.result);
      
      setStatusLoadingState(true, "جاري رفع وفحص ملف النسخة الاحتياطية...");
      
      const res = await fetch(`/api/guilds/${guildId}/backups/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedJson)
      });
      
      if (res.ok) {
        showToast("تم استيراد ورفع ملف النسخة الاحتياطية بنجاح!");
        await loadBackups(guildId);
      } else {
        const data = await res.json();
        throw new Error(data.error || "رفع غير صحيح");
      }
    } catch (err) {
      showToast(err.message || "ملف النسخة الاحتياطية تالف أو غير صالح للتركيب", "error");
    } finally {
      setStatusLoadingState(false);
      backupFileUploader.value = ""; // Clear file selector
    }
  };
  reader.readAsText(file);
});

// ── AUDIT LOGS MANAGEMENT ──

// Load Audit Logs Table
async function loadLogs(guildId) {
  logsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">جاري تحميل سجلات العمليات...</td></tr>`;
  try {
    const res = await fetch(`/api/guilds/${guildId}/logs`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.logs = data.logs;
    
    renderLogsList();
  } catch {
    logsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger);">تعذر تحميل سجل الأحداث الحالي.</td></tr>`;
  }
}

// Render Audit Logs based on page and filters
function renderLogsList() {
  logsTableBody.innerHTML = "";
  
  const actionFilter = logFilterAction.value;
  const userFilter = logFilterUser.value.trim().toLowerCase();
  
  // Filter logs
  let filtered = state.logs;
  if (actionFilter) {
    filtered = filtered.filter(l => l.action === actionFilter);
  }
  if (userFilter) {
    filtered = filtered.filter(l => (l.actorId && l.actorId.toLowerCase().includes(userFilter)));
  }
  
  if (filtered.length === 0) {
    logsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted);">لا توجد سجلات تطابق عوامل البحث المحددة.</td></tr>`;
    return;
  }
  
  // Paginate logs
  const start = (state.logsCurrentPage - 1) * state.logsPageSize;
  const end = start + state.logsPageSize;
  const pageLogs = filtered.slice(start, end);
  
  pageLogs.forEach(l => {
    const tr = document.createElement("tr");
    
    // Format action badge
    let badgeClass = "badge-info";
    let friendlyAction = l.action;
    if (l.action === "SETTINGS_UPDATED") {
      badgeClass = "badge-warn";
      friendlyAction = "تعديل إعدادات";
    } else if (l.action === "STREAK_DAY_COMPLETED") {
      badgeClass = "badge-success";
      friendlyAction = "إكمال ستريك يومي";
    } else if (l.action === "REWARD_EARNED") {
      badgeClass = "badge-full";
      friendlyAction = "ربح مكافأة";
    } else if (l.action === "ROLES_MATCHED") {
      badgeClass = "badge-partial";
      friendlyAction = "تحديث رتب الستريك";
    } else if (l.action === "STREAK_BROKEN") {
      badgeClass = "badge-danger";
      friendlyAction = "كسر الستريك";
    }
    
    const timeStr = new Date(l.createdAt).toLocaleString();
    const details = l.after ? JSON.stringify(l.after) : "-";
    
    // Actor display with avatar
    let actorHtml;
    if (l.actor) {
      const avatarHtml = l.actor.avatarUrl
        ? `<img src="${l.actor.avatarUrl}" alt="" class="log-actor-avatar" />`
        : '';
      actorHtml = `${avatarHtml}<strong>${l.actor.username}</strong>`;
    } else {
      actorHtml = `<strong class="code">${l.actorId || "System"}</strong>`;
    }
    
    // Highlight critical events
    if (l.action === "STREAK_BROKEN" || l.action === "SETTINGS_UPDATED") {
      tr.classList.add("log-row-critical");
    }
    
    tr.innerHTML = `
      <td style="font-family: monospace; font-size: 12px; font-weight: 600;">${timeStr}</td>
      <td><span class="badge ${badgeClass}">${friendlyAction}</span></td>
      <td class="log-actor-cell">${actorHtml}</td>
      <td>${l.entity || "-"} (${l.entityId || "-"})</td>
      <td class="log-details-cell" title='${details}'>${details.slice(0, 50)}${details.length > 50 ? "..." : ""}</td>
    `;
    
    logsTableBody.appendChild(tr);
  });
  
  // Render pagination controls
  renderLogsPagination(filtered.length);
}

// Add filters listeners for Logs
logFilterAction?.addEventListener("change", () => {
  state.logsCurrentPage = 1;
  renderLogsList();
});
logFilterUser?.addEventListener("input", () => {
  state.logsCurrentPage = 1;
  renderLogsList();
});

// Export Logs to CSV
btnExportLogs?.addEventListener("click", () => {
  const guildId = state.selectedGuildId;
  if (!guildId || state.logs.length === 0) {
    showToast("لا توجد سجلات لتصديرها", "error");
    return;
  }

  let csvContent = "\ufeff" + "التاريخ والوقت,نوع العملية,المسؤول (Actor),الهدف (Target),معرف الهدف (Target ID),التفاصيل\n";
  
  state.logs.forEach(l => {
    const timeStr = new Date(l.createdAt).toLocaleString().replace(/,/g, " ");
    const action = l.action;
    const actor = l.actorId || "System";
    const entity = l.entity || "";
    const entityId = l.entityId || "";
    const details = l.after ? JSON.stringify(l.after).replace(/"/g, '""').replace(/,/g, ";") : "";
    
    csvContent += `"${timeStr}","${action}","${actor}","${entity}","${entityId}","${details}"\n`;
  });
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `audit-logs-${guildId}-${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Run Initial Boot
boot();

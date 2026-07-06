# Discord Daily Streak

بنية أولية احترافية لنظام Daily Streak على Discord.

## رأيي في النص الأصلي

الفكرة قوية ومناسبة كبوت تجاري، لكن النص الأصلي يجمع كل شيء في مرحلة واحدة. أفضل ممارسة هي تنفيذها على مراحل:

1. النواة: احتساب الستريك، الإعدادات، الرسائل، الفويس، السجلات.
2. الإدارة: Dashboard، الرتب، المكافآت، Leaderboard.
3. الاعتمادية: نسخ احتياطي، مراقبة، مهام خلفية، Sharding.
4. التكاملات: ProBot Credits أو أي أنظمة خارجية بعد تثبيت النواة.

النقطة المهمة: لا يمكن ضمان "بدون أي خطأ" حرفياً، لكن يمكن تصميم النظام بحيث يمنع الأخطاء الشائعة عبر Transactions وIdempotency واختبارات ومراقبة.

## المتطلبات المحلية

- Node.js 20 أو أحدث.
- PostgreSQL 15 أو أحدث.
- Discord Bot Token.
- Discord Application Client ID.
- `DASHBOARD_ADMIN_TOKEN` عشوائي بطول 32 حرفاً أو أكثر لحماية لوحة التحكم.
- تفعيل Privileged Intents المطلوبة من Discord Developer Portal:
  - Server Members Intent عند الحاجة للرتب والأعضاء.
  - Message Content Intent إذا كان احتساب الرسائل يعتمد على محتوى الرسالة.
- صلاحيات البوت داخل السيرفر:
  - View Channels
  - Send Messages
  - Read Message History
  - Manage Roles إذا ستستخدم مكافآت الرتب
  - Use Slash Commands

## التشغيل المحلي

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run deploy:commands
npm run dev
```

على Windows استخدم نسخ الملف يدوياً أو:

```powershell
Copy-Item .env.example .env
```

## التشغيل عبر Docker

```bash
docker compose up --build -d
```

قبل التشغيل ضع هذه القيم في ملف `.env`:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` للتجربة على سيرفر واحد بسرعة، أو اتركه فارغاً للأوامر العامة.
- `DASHBOARD_ADMIN_TOKEN`
- `PUBLIC_BASE_URL`

لوحة التحكم تكون على:

```text
http://localhost:3000
```

اسم المستخدم في نافذة الدخول يمكن أن يكون أي قيمة، وكلمة المرور هي `DASHBOARD_ADMIN_TOKEN`.

## متطلبات السيرفر

- VPS أو Container بذاكرة 1GB كحد أدنى للنواة، و2GB+ عند وجود Dashboard ومهام خلفية.
- PostgreSQL مستقل أو Managed Database.
- Reverse proxy مثل Nginx/Caddy للوحة التحكم.
- HTTPS إجباري للوحة التحكم.
- إدارة أسرار عبر Environment Variables، وليس داخل الكود.
- نسخ احتياطي يومي لقاعدة البيانات.
- نظام تشغيل مستمر مثل systemd أو Docker Compose.

## البنية

- `src/discord`: اتصال Discord واستقبال الأحداث.
- `src/streak`: منطق الستريك وحساب اليوم.
- `src/web`: واجهة Dashboard أولية.
- `src/security`: حماية لوحة التحكم ومعالجة الأخطاء بدون تسريب تفاصيل.
- `prisma/schema.prisma`: قاعدة البيانات والعلاقات الأساسية.
- `docs/architecture.md`: التصميم المعماري المقترح.
- `docs/requirements.md`: المتطلبات التقنية والتشغيلية.

## ما اكتمل في هذه المرحلة

- احتساب رسائل Discord بدون تخزين محتوى الرسائل.
- احتساب جلسات الفويس عند الخروج من القناة.
- منع تكرار الحدث عبر Unique Idempotency Key.
- أوامر Slash: `/streak`, `/leaderboard`, `/streak-settings`.
- Dashboard محمي بتوكن إداري.
- CSP وHelmet وRate limiting وError handler.
- PostgreSQL schema مع جداول الستريك، السجلات، الرتب، المكافآت، الاسترجاع، والنسخ.
- Dockerfile وDocker Compose للتشغيل على سيرفر.

## ما يبقى بعد هذه المرحلة

- ربط ProBot Credits يحتاج اختباراً حقيقياً داخل Discord لأن طريقة التحقق تعتمد على رسائل ProBot وسلوكها.
- Sharding لا تحتاجه إلا بعد نمو البوت لعدد كبير من السيرفرات.
- النسخ الاحتياطي الإنتاجي الأفضل يكون من PostgreSQL/السيرفر، وليس من البوت وحده.
- تسجيل أوامر Slash العامة قد يأخذ وقتاً من Discord؛ أثناء التطوير استخدم `DISCORD_GUILD_ID`.

# المتطلبات

## Discord Developer Portal

1. إنشاء Application.
2. إنشاء Bot.
3. نسخ `DISCORD_TOKEN`.
4. تفعيل Intents المطلوبة فقط.
5. توليد رابط دعوة OAuth2 بصلاحيات:
   - `bot`
   - `applications.commands`

## Environment Variables

- `DISCORD_TOKEN`: توكن البوت.
- `DISCORD_CLIENT_ID`: معرف التطبيق.
- `DISCORD_GUILD_ID`: اختياري لنشر الأوامر على سيرفر اختبار واحد.
- `DATABASE_URL`: رابط PostgreSQL.
- `WEB_PORT`: منفذ لوحة التحكم.
- `PUBLIC_BASE_URL`: رابط اللوحة العام.
- `DASHBOARD_ADMIN_TOKEN`: كلمة مرور لوحة التحكم، يجب أن تكون عشوائية وطويلة.

## قاعدة البيانات

PostgreSQL مطلوبة لأن النظام يحتاج:

- Transactions.
- Unique constraints لمنع التكرار.
- Indexes للـ Leaderboard.
- JSONB للإعدادات المرنة.
- Migrations آمنة.

## صلاحيات السيرفر

للتجربة الأساسية:

- إرسال وقراءة الرسائل.
- استخدام Slash Commands.

للمكافآت:

- Manage Roles.

للفويس:

- View Channels.
- Connect ليس ضرورياً إلا إذا كان البوت سيدخل القنوات.

## خطة تنفيذ آمنة

1. تشغيل الرسائل فقط.
2. إضافة Dashboard للإعدادات.
3. إضافة الرتب والمكافآت.
4. إضافة الفويس.
5. إضافة Leaderboard.
6. إضافة Backup وWorkers.
7. إضافة ProBot Restore بعد اختبار النواة.

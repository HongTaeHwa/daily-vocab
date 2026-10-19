package kr.dailyvocab.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * 갤럭시 앱 로컬 알림(알림 2B의 N2, v1.5). WebView 에는 Web Push 가 없어서, 아이폰·Chrome 이 가족 Worker 의 푸시로 받는
 * 두 가지 알림을 앱이 스스로 띄운다.
 *   📬 daily    — 보호자가 정한 오늘의 단어 시각(KST)에 ‘오늘의 단어가 도착했어요’ (서버가 정각에 만들므로 5분 뒤)
 *   ✏️ reminder — 보호자가 정한 공부 알림 시각(KST)에 ‘오늘 아직 단어 시험을 안 봤어요’. 웹앱이 시험을 끝낼 때 skipToday("reminder")를 불러 그날은 건너뛴다.
 * 시각은 웹앱(family.js nativeSchedule)이 보호자 설정을 받을 때마다 NotifyBridge.schedule 로 넘겨 주고 여기 SharedPreferences 에 둔다.
 * 알람은 AlarmManager.setAndAllowWhileIdle(정확 알람 권한 불필요, 몇 분 늦을 수 있음)로 다음 한 번만 걸고, 울릴 때마다 다음 날 것을 다시 건다.
 * 재부팅·앱 업데이트 뒤에는 BootReceiver 가 다시 건다. 시각은 서버와 같은 한국 시각(Asia/Seoul)으로 계산한다.
 */
object NotifyScheduler {
    const val KIND_DAILY = "daily"
    const val KIND_REMINDER = "reminder"
    const val EXTRA_KIND = "kind"
    const val EXTRA_TARGET = "target"
    private const val CHANNEL_ID = "daily-vocab"
    private const val PREFS = "daily_vocab_notify"
    private const val DAILY_MINUTE = 5 // 서버 크론이 정각에 오늘의 단어를 만든다(생성에 10초쯤). 조금 뒤에 알린다.
    private const val REMINDER_MINUTE = 0
    private const val STALE_MS = 3L * 60 * 60 * 1000 // 3시간 넘게 늦게 온 알람(기기가 꺼져 있었음 등)은 띄우지 않고 다음 날로 넘긴다
    private val KST: ZoneId = ZoneId.of("Asia/Seoul")
    private val DAY: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun today(): String = ZonedDateTime.now(KST).format(DAY)
    private fun notificationId(kind: String) = if (kind == KIND_DAILY) 101 else 102
    private fun requestCode(kind: String) = if (kind == KIND_DAILY) 1 else 2

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.notify_channel_name), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.notify_channel_desc)
        manager.createNotificationChannel(channel)
    }

    /** 웹앱이 넘긴 설정을 저장하고 알람을 다시 건다. hour 가 null 이면 그 알림은 끈다. */
    @Synchronized
    fun configure(context: Context, dailyHour: Int?, reminderHour: Int?) {
        prefs(context).edit()
            .putBoolean("enabled", true)
            .putInt("daily_hour", dailyHour ?: -1)
            .putInt("reminder_hour", reminderHour ?: -1)
            .apply()
        rescheduleAll(context)
    }

    /** 알림을 모두 끈다(웹앱의 ‘알림 끄기’·연결 해제). */
    @Synchronized
    fun disable(context: Context) {
        prefs(context).edit().clear().apply()
        for (kind in arrayOf(KIND_DAILY, KIND_REMINDER)) {
            cancelAlarm(context, kind)
            NotificationManagerCompat.from(context).cancel(notificationId(kind))
        }
    }

    /** 오늘(한국 날짜)은 이 알림을 띄우지 않는다. 이미 떠 있으면 거둔다(시험을 끝냈으면 리마인더는 필요 없다). */
    @Synchronized
    fun skipToday(context: Context, kind: String) {
        if (kind != KIND_DAILY && kind != KIND_REMINDER) return
        prefs(context).edit().putString("skip_$kind", today()).apply()
        NotificationManagerCompat.from(context).cancel(notificationId(kind))
    }

    /** 저장된 설정대로 두 알람을 다음 시각에 건다(재부팅·업데이트 뒤, 설정이 바뀔 때). */
    @Synchronized
    fun rescheduleAll(context: Context) {
        val p = prefs(context)
        if (!p.getBoolean("enabled", false)) {
            cancelAlarm(context, KIND_DAILY)
            cancelAlarm(context, KIND_REMINDER)
            return
        }
        scheduleOrCancel(context, KIND_DAILY, p.getInt("daily_hour", -1), DAILY_MINUTE)
        scheduleOrCancel(context, KIND_REMINDER, p.getInt("reminder_hour", -1), REMINDER_MINUTE)
    }

    private fun scheduleOrCancel(context: Context, kind: String, hour: Int, minute: Int) {
        if (hour !in 0..23) {
            cancelAlarm(context, kind)
            return
        }
        val now = ZonedDateTime.now(KST)
        var next = now.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
        if (!next.isAfter(now)) next = next.plusDays(1)
        val target = next.toInstant().toEpochMilli()
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return
        alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target, alarmIntent(context, kind, target))
    }

    private fun cancelAlarm(context: Context, kind: String) {
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return
        alarm.cancel(alarmIntent(context, kind, 0L))
    }

    private fun alarmIntent(context: Context, kind: String, target: Long): PendingIntent {
        val intent = Intent(context, NotifyReceiver::class.java).putExtra(EXTRA_KIND, kind).putExtra(EXTRA_TARGET, target)
        return PendingIntent.getBroadcast(context, requestCode(kind), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** 알람이 울렸다: 조건이 맞으면 알림을 띄우고 다음 날 알람을 건다. */
    @Synchronized
    fun fire(context: Context, kind: String, target: Long) {
        val p = prefs(context)
        if (!p.getBoolean("enabled", false)) return
        val hourKey = if (kind == KIND_DAILY) "daily_hour" else "reminder_hour"
        val hour = p.getInt(hourKey, -1)
        if (hour !in 0..23) return
        val day = today()
        val stale = target > 0 && System.currentTimeMillis() - target > STALE_MS
        val skipped = p.getString("skip_$kind", "") == day
        val alreadyShown = p.getString("shown_$kind", "") == day
        if (!stale && !skipped && !alreadyShown && show(context, kind)) p.edit().putString("shown_$kind", day).apply()
        scheduleOrCancel(context, kind, hour, if (kind == KIND_DAILY) DAILY_MINUTE else REMINDER_MINUTE)
    }

    @SuppressLint("MissingPermission") // 아래에서 권한·알림 허용을 직접 확인한다
    private fun show(context: Context, kind: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return false
        ensureChannel(context)
        val daily = kind == KIND_DAILY
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(context, requestCode(kind), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(ContextCompat.getColor(context, R.color.navy))
            .setContentTitle(context.getString(if (daily) R.string.notify_daily_title else R.string.notify_reminder_title))
            .setContentText(context.getString(if (daily) R.string.notify_daily_body else R.string.notify_reminder_body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        manager.notify(notificationId(kind), notification)
        return true
    }
}

/** 알람이 울리면 NotifyScheduler.fire 로 넘긴다(앱 안에서만 부르는 명시적 브로드캐스트, exported=false). */
class NotifyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind = intent.getStringExtra(NotifyScheduler.EXTRA_KIND) ?: return
        NotifyScheduler.fire(context, kind, intent.getLongExtra(NotifyScheduler.EXTRA_TARGET, 0L))
    }
}

/** 재부팅·앱 업데이트 뒤에는 알람이 사라지므로 저장된 설정대로 다시 건다. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> NotifyScheduler.rescheduleAll(context)
        }
    }
}

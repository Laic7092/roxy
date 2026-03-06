---
name: cron
description: Schedule reminders and recurring tasks with flexible timing options.
---

# Cron Skill

Schedule reminders and recurring tasks using the `cron` tool. Supports three execution modes and multiple time expression formats.

## Job Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Reminder** | Sends message directly to user | Break reminders, standup alerts |
| **Task** | Agent executes message as a task | Periodic checks, automated reports |
| **One-time** | Runs once at specific time, then auto-deletes | Meeting reminders, scheduled notifications |

## Usage Examples

### Interval-based (every N seconds)

```typescript
// Reminder every 20 minutes
cron(action="add", message="Time to take a break!", every_seconds=1200)

// Task every 10 minutes
cron(action="add", message="Check GitHub stars and report", every_seconds=600, type="task")

// Every hour
cron(action="add", message="Hourly status check", every_seconds=3600)
```

### Cron Expression (scheduled times)

```typescript
// Daily at 8am
cron(action="add", message="Morning standup", cron_expr="0 8 * * *")

// Weekdays at 5pm
cron(action="add", message="End of day summary", cron_expr="0 17 * * 1-5")

// Every 15 minutes
cron(action="add", message="Quick check", cron_expr="*/15 * * * *")
```

### Timezone-aware Scheduling

```typescript
// 9am Vancouver time daily
cron(action="add", message="Morning standup", cron_expr="0 9 * * *", tz="America/Vancouver")

// 6pm London time on Fridays
cron(action="add", message="Weekly review", cron_expr="0 18 * * 5", tz="Europe/London")
```

### One-time Scheduled Task

```typescript
// Calculate ISO datetime from current time
const meetingTime = new Date()
meetingTime.setHours(14, 30, 0) // 2:30 PM today
cron(action="add", message="Team meeting in 30 minutes", at=meetingTime.toISOString())
```

### Management Operations

```typescript
// List all scheduled jobs
cron(action="list")

// Remove a specific job
cron(action="remove", job_id="abc123")

// Pause a job temporarily
cron(action="pause", job_id="abc123")

// Resume a paused job
cron(action="resume", job_id="abc123")
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `add`, `list`, `remove`, `pause`, `resume` |
| `message` | string | For `add` | Reminder or task description |
| `every_seconds` | number | For interval | Interval in seconds (min: 1) |
| `cron_expr` | string | For schedule | Standard cron expression (5 fields) |
| `at` | string | For one-time | ISO 8601 datetime string |
| `tz` | string | Optional | IANA timezone (e.g., `America/Vancouver`) |
| `job_id` | string | For management | Job ID from `add` response or `list` |
| `type` | string | Optional | `reminder` (default), `task`, or `one_time` |

## Cron Expression Format

Standard 5-field cron format:
```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6)
│ │ │ │ │
* * * * *
```

Special characters:
- `*` - any value
- `,` - value list separator
- `-` - range
- `/` - step values
- Example: `0 9 * * 1-5` = 9:00 AM on weekdays

## Time Expression Reference

| Natural Language | Parameters |
|------------------|------------|
| every 20 minutes | `every_seconds: 1200` |
| every hour | `every_seconds: 3600` |
| every day at 8am | `cron_expr: "0 8 * * *"` |
| weekdays at 5pm | `cron_expr: "0 17 * * 1-5"` |
| every 15 minutes | `cron_expr: "*/15 * * * *"` |
| 9am Vancouver time daily | `cron_expr: "0 9 * * *"`, `tz: "America/Vancouver"` |
| at a specific time | `at: "2025-03-06T14:30:00"` |

## Common Timezones

| Name | IANA Format |
|------|-------------|
| Pacific Time (Vancouver) | `America/Vancouver` |
| Eastern Time (New York) | `America/New_York` |
| Central Time (Chicago) | `America/Chicago` |
| Mountain Time (Denver) | `America/Denver` |
| London (GMT) | `Europe/London` |
| UTC | `UTC` |
| Tokyo (JST) | `Asia/Tokyo` |
| Shanghai (CST) | `Asia/Shanghai` |

## Response Format

### Add Job Response
```json
{
  "success": true,
  "job_id": "abc123-def456",
  "type": "reminder",
  "next_execution": "2025-03-06T14:30:00.000Z",
  "message": "Scheduled reminder: \"Time to take a break!\""
}
```

### List Jobs Response
```json
{
  "success": true,
  "jobs": [
    {
      "id": "abc123",
      "type": "reminder",
      "message": "Time to take a break!",
      "active": true,
      "execution_count": 5,
      "last_execution": "2025-03-06T14:20:00.000Z",
      "next_execution": "2025-03-06T14:40:00.000Z",
      "cron_expr": "*/20 * * * *"
    }
  ]
}
```

## Best Practices

1. **Use descriptive messages** - Clear reminders are more effective
2. **Choose appropriate intervals** - Don't spam users with frequent notifications
3. **Use timezone-aware scheduling** - Always specify `tz` for user-facing schedules
4. **Clean up unused jobs** - Remove jobs when no longer needed
5. **Monitor execution count** - Check `list` output to verify jobs are running

## Notes

- Jobs persist only during the session (not saved to disk)
- One-time jobs auto-delete after execution
- Maximum interval: 7 days (604800 seconds)
- Cron expressions use server timezone unless `tz` is specified

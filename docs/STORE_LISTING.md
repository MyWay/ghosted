# Chrome Web Store listing

## Name (max 75 characters)

Ghosted — Unfollower Tracker for X

## Summary (max 132 characters, comes from `manifest.description`)

See who unfollowed you on X. Tracks followers and following over time, fully local: no account, no server.

## Category

Productivity (alternative: Social & Communication)

## Detailed description

Find out who unfollowed you on X, and when.

Ghosted keeps a private history of your followers and following lists. Each time you run a check, it compares the lists with the previous check and shows exactly what changed: who unfollowed you, who followed you, and who stopped following you back.

WHAT YOU GET
• Unfollowers: a timeline of everyone who left, with their avatar and handle
• New followers and lost mutuals
• People you follow who don't follow you back, plus fans you don't follow back
• Follower growth charts: followers over time, and gained vs lost per day
• A red number on the toolbar icon when someone unfollows you
• Optional alerts on Telegram or Discord
• Backup and restore: export your history as a file, import it on another computer
• Notices renamed accounts, so a new @handle isn't reported as an unfollow

PRIVATE BY DESIGN
• No account, no sign-up, no X password
• No servers: everything is stored inside your browser
• No analytics and no tracking
• The only data that ever leaves your computer is the alert message you choose to send to your own Telegram chat or Discord channel

HOW IT WORKS
1. Log in to x.com in this browser.
2. Click the Ghosted icon and press "Check now".
3. Keep the X tab open and visible until it says "Check complete".

Your first check records who follows you today. Changes appear from your second check on. Ghosted never sends its own requests to X: it reads the follower lists that X loads while they scroll, and scrolls the page for you during a check.

GOOD TO KNOW
• Checks run when you start them, with the browser open. Ghosted reminds you once a day.
• Very large accounts take longer to check. If X slows things down, Ghosted stops and you can try again later.
• Ghosted only works on x.com and twitter.com.

Ghosted is an independent tool and is not affiliated with, endorsed by, or sponsored by X Corp. "X" is a trademark of X Corp.

## Developer Dashboard > Privacy practices (paste-ready; each field allows 1,000 characters)

### Single purpose description

Ghosted lets a user track changes to their own followers and following lists on X (x.com) and see who unfollowed them. When the user starts a check, the extension records the follower and following lists that X loads in their browser, compares them with the previous check, and shows what changed in a popup and a dashboard. It can also alert the user (browser notification, plus an optional Telegram or Discord message they set up themselves). All data stays in the user's browser.

### storage

chrome.storage.local holds the user's notification preferences, including the optional Telegram bot token and chat id or Discord webhook URL that the user types in. chrome.storage.session holds the temporary state of a check that is in progress. Nothing is synced to a server or shared.

### unlimitedStorage

The extension keeps a local history of the user's followers and following lists and of every change between checks (account id, handle, display name, avatar URL). An account with tens or hundreds of thousands of followers produces a history larger than the default browser storage quota, so unlimitedStorage prevents data loss. The data never leaves the device.

### alarms

Used for two local housekeeping tasks: (1) an hourly check of whether the user's last check is older than their chosen reminder interval (default 24 hours), so a 'time for a check' reminder can be shown; (2) a 5-minute task that closes checks that stopped without finishing, so partial data is never compared with earlier data. No alarm contacts any server.

### notifications

Shows a local notification when a check finds that someone unfollowed the user or stopped following them back, and the daily 'time for a check' reminder. The user can turn browser notifications off in Settings.

### cookies

Reads exactly one cookie, 'twid', on x.com / twitter.com, to learn the numeric id of the account that is logged in. This lets the extension record data only for the user's own lists (and ignore lists of other profiles they browse) and keep data separate if several X accounts are used in one browser. Only the numeric account id derived from it is stored, locally; it is never sent anywhere. The extension does not read authentication tokens, passwords or any other cookie.

### Host permission (x.com, twitter.com)

Two content scripts run on x.com and twitter.com. One observes the follower, following and profile responses that X's own web app loads for the logged-in user (the extension sends no requests of its own to X) and notes when the user clicks Unfollow, so changes can be labelled correctly. The other scrolls the user's own followers/following page during a check and shows a progress panel. The extension does nothing on other sites. Access to api.telegram.org, discord.com and discordapp.com is optional: requested only if the user turns on those alerts, and used only to send the alert message.

### Remote code

**No, I do not use remote code.** All JavaScript is bundled in the package; there is no `eval`, no external `<script>`, and no dynamically loaded modules. (The only network calls are the optional Telegram/Discord alert messages.)

### Data usage: which user data is collected

Check these three, leave the rest unchecked:

- **Personally identifiable information:** handles, display names and account ids of accounts in the user's own follower and following lists, and the user's own account id.
- **User activity:** the extension notes when the user clicks Unfollow on x.com, to label changes correctly.
- **Website content:** the follower and following lists and profile picture URLs that x.com loads.

All of it stays on the user's device. The optional Telegram/Discord alert is sent only to the chat or webhook the user entered.

### Data usage: certifications

Tick all three:

- I do not sell or transfer user data to third parties, except for approved use cases
- I do not use or transfer user data for purposes unrelated to the item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

`https://github.com/MyWay/ghosted/blob/main/docs/PRIVACY.md` (works only once the repository is public and this file is pushed to `main`)

## Screenshots (1280×800, 24-bit PNG, no transparency; max 5)

Ready in `store/screenshots/`, all made with demo data (fake names and generated avatars):

1. `1-overview.png`: dashboard Overview with follower count, growth chart, gained vs lost
2. `2-timeline.png`: timeline of unfollowers and new followers
3. `3-popup.png`: popup with "Check now" and the latest changes, on a branded background
4. `4-not-following-back.png`: people who don't follow you back
5. `5-setup.png`: first-run setup guide

Upload them in this order; the first one is the one shown most prominently.

## Promo images

- Small promo tile (440×280): `store/promo-small-440x280.png`
- Marquee promo tile (1400×560): `store/promo-marquee-1400x560.png`

Both are 24-bit PNGs without transparency.

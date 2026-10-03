<p align="center"><img src="public/icon/128.png" width="96" alt="Ghosted logo"></p>

<h1 align="center">Ghosted</h1>
<p align="center">See who unfollowed you on X. Free, private, and it runs entirely in your browser.</p>

---

## What it does

- Tells you **who unfollowed you**, and who followed you
- Shows who **doesn't follow you back**
- Spots **boomerangs**: people who keep unfollowing and following you again
- A red number on the toolbar icon when someone leaves
- Optional alerts on **Telegram**, **Discord**, or **any webhook** (n8n, Zapier, Slack, Home Assistant…)

No account, no server, no X password. Your data never leaves your computer.

## Install

**Chrome, Edge, Brave**

1. Download `ghosted-chrome.zip` from the Releases page and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

**Firefox**

1. Download `ghosted-firefox.xpi` from the Releases page.
2. Open the file in Firefox and click **Add**.

A setup page opens when the install finishes. Follow its three steps.

## How to use

1. Log in to **x.com** in the same browser.
2. Click the Ghosted icon and press **Check now**.
3. Leave the X tab open and visible until it says **Check complete**.

The first check records who follows you today. From the next check on, Ghosted shows who
left and who joined. Check once a day; Ghosted reminds you.

Tip: pin Ghosted to your toolbar (puzzle-piece icon → pin) so you can see the red number.

## FAQ

**Why is nothing showing after my first check?**
The first check is the starting point. Changes appear from the second check on.

**Does it check automatically?**
No. It only sees your lists when you run a check, so the browser must be open. You get a daily
reminder.

**Can X ban me for this?**
The risk is low, but not zero. Ghosted never sends its own requests to X; it only reads the lists
X loads while you (or its auto-scroll) browse them. If X slows you down, Ghosted stops and you can
try again later. X's terms restrict automated tools, so use it at your own risk.

**Why isn't it in the Chrome Web Store?**
Ghosted is distributed only through GitHub for now. Chrome shows a "developer mode" warning at
startup for extensions installed this way, and they don't update on their own.

**How do I update?**
Chrome: unzip the new release **into the same folder** (replace the old files), then click the
reload icon on Ghosted in `chrome://extensions`. Loading it from a different folder installs a
separate copy with empty history. Firefox: open the new `.xpi`; your history is kept.

**Is my data safe?**
Everything stays in your browser. See the [privacy policy](docs/PRIVACY.md).

**How do I back up or move my history?**
Dashboard → Settings → **Export**, then **Import** it in the other browser.

---

Ghosted is not affiliated with or endorsed by X Corp.

Developers: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Licensed under the [MIT License](LICENSE).

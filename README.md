# family-dash

A self-hosted family dashboard and planner for a wall-mounted touchscreen. Calendar, tasks and
chores, sticky notes, recipes and meal planning, photos, weather, news and a freehand drawing
pad, running on your own hardware, with no subscription and no vendor holding your data.

Built to run on a Raspberry Pi with a touchscreen monitor, in either portrait or landscape.

## Features

**Working now:**

- **Settings**: theme (including one that follows sunrise and sunset), accent, clock, screensaver, on-screen keyboard, calendar defaults, dashboard widgets, household names, location and units, plus service diagnostics. Changes save as you make them.
- **Calendar**:month, week and agenda views merged across the local family calendar, any number
  of ICS subscriptions and a connected Google account, with background sync, tap-a-day to add,
  and read-only handling for events a feed owns.
- **Tasks and chores**: grouped by when they are due, quick-add, priorities, free-text
  assignment, and repeating chores that reappear once ticked off.
- **News**: headlines aggregated from RSS, which needs no account. Images, bylines and summaries
  are recovered from whatever shape each feed offers, cached locally, and pruned on a retention window. Tapping a story shows its summary and a QR code to finish reading on your device
- **Weather**: current conditions, a 24-hour strip and a seven-day outlook from
  [Open-Meteo](https://open-meteo.com). Set the location by searching
  for your town rather than typing coordinates. Forecasts are cached in Postgres, so the page is instant and a network outage shows the last forecast clearly marked stale rather than an error.
- **Meals**: a seven-day planner, a reusable recipe library, and a shopping list built from the
  two. Ingredients are merged across the week (three recipes using flour give one line with the
  total), grouped by supermarket aisle, and a QR code hands the live list to a phone on the same
  wifi so ticking items off in a shop shows up on the wall.
- **Sticky notes**: a draggable corkboard of typed *or handwritten* notes. Handwriting is
  captured from a finger or stylus via pointer events (with pressure and palm rejection) and
  stored as smoothed vector strokes, so a note stays crisp whether it is full size on the board
  or shrunk into a dashboard widget. Pin a note to show it on the dashboard.
- **Photos**: an album browser over a folder on the mounted media volume, because Google Photos
  cannot list a library any more. Pictures arrive by uploading them or by copying them onto the
  volume; an hourly scan reconciles the two, reads capture dates from EXIF so the library is in
  the order things actually happened, and generates thumbnails. HEIC from a phone works. A
  full-screen slideshow at a configurable interval, favourites for the dashboard widget, and
  deleting a picture removes the file rather than just the index row. Can be linked to a network share.
- **Draw**: a full-page sketch pad using the same ink control as handwritten notes, with an
  eraser, a wider palette, five pen widths and a choice of paper colour. Drawings are saved as
  vectors and listed in a gallery that renders its own thumbnails, so there are no image files
  to manage and a sketch stays sharp at any size. Undo reverses whichever thing happened last.
- **Dashboard**: every widget reads live data: next events, today's tasks, pinned notes,
  tonight's meal with the outstanding shopping count, current weather, the latest headlines, and
  a slowly cycling photo.
- **On-screen keyboard**: for a wall display with no keyboard attached. Appears when a text field
  is tapped, with a keypad for number fields and a QWERTY for everything else; `Done` sends a real
  Enter, so the forms that act on it still work. Anything anchored to the bottom of the screen moves clear of it. Set to auto by default, which means on for a
  touchscreen and off where there is a mouse, decided per screen rather than per install.
- **Screensaver**: after a configurable idle spell the screen becomes a clock, the current
  temperature and a slow slideshow of the favourited photos, which is more use from across a
  kitchen than the dashboard it replaces and keeps one layout from burning into the panel. Any
  tap, key or scroll dismisses it. Off by default; set the idle minutes in Settings.

Recipes carry a picture from the photo library, so one can be uploaded once and reused, and
deleting it from the library clears the reference rather than leaving a broken image.

Calendars come from three providers behind one seam: the local family calendar, any number of ICS
subscriptions, and **Google Calendar**, two-way, so an event added on the wall is pushed to
Google as it is created. Events that came from an upstream calendar are not editable here, since
the next sync would undo the change; the app says so rather than losing the edit.

## Stack

| Layer    | Choice                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| UI       | Vue 3 + Vite + Tailwind 4, served by nginx                                   |
| API      | TypeScript + Express 5, decorator-driven controllers                         |
| Database | PostgreSQL 17, raw `pg` with SQL migrations applied at startup               |
| Runtime  | Docker Compose: three containers, one published port, arm64 and amd64        |

The API follows the conventions of
[dhlevi/express-ts-api-boilerplate](https://github.com/dhlevi/express-ts-api-boilerplate):
`@Route`/`@Get` decorators, a `RouteManager` that wires them onto Express, thin controllers over
`*Endpoints` classes holding the logic, a `TaskManager` for scheduled work, and a `HealthService`
behind `/healthCheck`.

## Getting started

You need Docker with Compose v2. Nothing else.

```bash
git clone <this-repo> family-dash && cd family-dash
make env                       # creates .env from .env.example
$EDITOR .env                   # set POSTGRES_PASSWORD, and your location
make up                        # build and start
```

Then open `http://localhost:8080` (or the Pi's address). `make help` lists every target.

The database schema is created automatically on first boot, along with a writable "Family"
calendar and a few news feeds to start from.

### Useful commands

```bash
make logs        # tail everything
make health      # print the API health report
make psql        # a psql shell on the database
make down        # stop, keeping data
make reset       # stop and delete the database (prompts first)
make check       # lint, typecheck and test both packages
```

## Configuration

Runtime configuration lives in two places, and environment always wins:

- **`.env`**: secrets and per-install values, read by Docker Compose. See `.env.example`.
- **`api/config/application.properties`**: defaults, pool sizes, cron schedules, media paths.

Anything in the properties file can be overridden by an environment variable: `media.thumbnail.width`
becomes `MEDIA_THUMBNAIL_WIDTH`. A handful have conventional names instead (`server.port` → `PORT`);
see `ENV_OVERRIDES` in `api/lib/core/AppProperties.ts`.

Application preferences, theme, dashboard widgets, calendar sources, feeds, API keys,  are stored in the database and edited in the Settings page, not in a file.

### External services

Weather works with **no API key at all**, via [Open-Meteo](https://open-meteo.com), which also
provides the place-name search used to set your location. An OpenWeatherMap key is optional; set
`weather.provider=openweathermap` in `api/config/application.properties` and supply a key to use
it instead. If a chosen provider is missing its key, the service falls back to one that works
rather than leaving the page empty.

News is **RSS**, which also needs no key. There is no official Google News API; the feed list is
editable in Settings.

Two Google APIs deserve a warning, because both shape the design:

- **Google Photos cannot be used as a photo source.** The Library API's read scopes were withdrawn
  in 2025, and an app can now only see media it uploaded itself. Photos therefore come from a
  folder mounted into the container (`MEDIA_PATH`) plus in-app upload.
- **Google Calendar OAuth apps left in "testing" mode expire their refresh tokens after 7 days**,
  which would silently stop a wall display from syncing. Calendar sources are pluggable for this
  reason: subscribing to a secret `.ics` URL needs no credentials and never expires, and Google,
  iCloud and Outlook all publish one. Google OAuth is available as one provider among several,
  not as the foundation.

#### Connecting Google Calendar

Only needed if you want events added on the dashboard to appear in Google too. To read a Google
calendar, subscribing to its secret `.ics` address is simpler and never needs re-authorising.

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth 2.0 Client ID** of type **Web application**.
2. Add an **authorised redirect URI**. Google matches these exactly, and it depends on the address
   you open the dashboard at, so the Settings page prints the one to use. From the Pi's own
   screen that is `http://localhost:8080/api/calendar/google/callback`.
3. Put the id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then
   `docker compose up -d`.
4. Set the OAuth **consent screen to "In production"**, not "Testing". You will see an
   "unverified app" warning when you connect, which is expected for an app only you use, click through it. Leaving the screen in Testing is what expires the refresh token after a week.
5. In Settings → Calendars, add a calendar of kind **Google account**, then connect it in the
   Google Calendar section below and pick which calendar to show.

Google only permits `http://` redirect URIs on `localhost`, so the connect step has to be done
from a browser that reaches the dashboard as `localhost`, the Pi's own screen, or an SSH tunnel
(`ssh -L 8080:localhost:8080 you@your-pi`). Everything afterwards works from any device.

If a connection dies, `/healthCheck` reports it under `calendar-sources` and Settings shows the
reason on the calendar itself. A calendar you have created but not yet connected is not treated
as a fault.

## Architecture

```
family-dash/
├── docker-compose.yml          three services: db, api, web
├── api/
│   └── lib/
│       ├── core/               Controller, Decorators, RouteManager, TaskManager,
│       │                       HealthService, AppProperties, OpenApiGenerator
│       ├── db/                 pool singleton, Migrator, migrations/*.sql
│       ├── controllers/        thin, decorated route declarations
│       ├── services/           *Endpoints.ts (the business logic)
│       ├── repositories/       SQL, one module per table
│       ├── providers/          calendar/ weather/ news/ (the pluggable seams)
│       ├── scheduled-tasks/    background refresh jobs
│       └── health-checks/      probes behind /healthCheck
└── web/
    └── src/
        ├── api/                typed client per feature over fetch
        ├── components/         dashboard widgets and shared UI
        ├── composables/        clock, orientation
        ├── stores/             Pinia
        └── views/              one per tab
```

There is no `providers/photos/`. I intended to use google photos, but Google Photos API is deprecated and cannot list a library.

- External data is cached in Postgres, never fetched on page load.
- The UI is touch-first and orientation-agnostic.
- Feed content is treated as untrusted input.
- Ink is stored as vectors, not pixels.
- The screensaver's crossfade avoids `<Transition>` on purpose. Vue advances transition classes
- on a `requestAnimationFrame`, which does not run while a page is hidden. The screensaver caught mid-fade would sit at `opacity: 0` indefinitely. The two picture layers fade on a bound `opacity` instead: it may or may not animate, but it always ends up at the right value.
- The on-screen keyboard is in the app, not the OS. Note that Pi does have an onscreen keyboard option, so if you prefer to use that, you can disable the app one.
- An empty photo library is treated as an unmounted volume, not as an empty library.

## Development

Hot reload for both packages, with Postgres in Docker:

```bash
make dev      # API under tsx watch, Vite dev server, db published on 5432
```

Or work outside Docker against the containerised database:

```bash
make install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
cd api && npm run dev     # reads PG* from your environment
cd web && npm run dev     # proxies /api to localhost:3000
```

Before pushing: `make check` (lint, typecheck, tests for both packages). CI runs the same, plus a
compose smoke test that boots the whole stack from an empty database, and a multi-arch image build.

### Migrations

Add a numbered file to `api/lib/db/migrations/002_add_thing.sql`. It is applied inside a
transaction on the next boot and recorded with a checksum. **Migrations are immutable once
applied**: editing one that has already run fails startup with a checksum mismatch rather than
letting two installs diverge. Add a new file instead. Note: This may change to a liquibase or flyway runner at some point, if I get that excitable or the DB really needs more than we're doing here now. For the time being, it's simple enough that a full devops build is kinda overkill outside of practice

The checksum covers the whole file, comments included, so correcting a typo in an applied
migration stops the API booting even though the schema is untouched. When that is genuinely all
that changed, record the new checksum rather than reverting the edit:

```bash
docker compose run --rm --entrypoint sh api -c "node build/db/cli.js --reseal 001_init.sql"
```

`docker compose run` rather than `exec`, because a container that will not boot cannot be exec'd
into. This asserts the change was cosmetic; if it was not, the database and the migration have
diverged and nothing will tell you so later.

### Adding an endpoint (If you want to add your own API calls, etc)

```ts
@Route('api/tasks')
export class TaskController extends Controller {
  public constructor () { super() }

  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async list (@Query('assignee') assignee?: string): Promise<TaskItem[]> {
    return endpoints.list(assignee)
  }
}
```

Then instantiate it in `api/lib/routes/Routes.ts`. A decorated controller that is never
instantiated, or an endpoint missing its verb decorator, **fails startup with an explanatory
error** rather than silently serving nothing.

Path, query and header arguments are coerced to their declared types (`number`, `boolean`, `Date`)
using `emitDecoratorMetadata`, and a value that cannot be coerced becomes a 400 before your
handler runs.

`/openapi` serves a browsable API document, generated at runtime from the same registry the router
was built from, so it always describes the routes that actually exist, and there is no build step to fall out of date.

You can go to the boilerplate project to see more about how the API works: [dhlevi/express-ts-api-boilerplate](https://github.com/dhlevi/express-ts-api-boilerplate)

## Raspberry Pi

A Pi 4 or 5 with 2GB is comfortable; the stack idles at a few hundred MB. Use a good SD card, or better, boot from USB/NVMe. Postgres on a cheap card is the main thing that will make this feel slow.

### Quickstart

**Before you start**, you need **64-bit Raspberry Pi OS** the images are `arm64` only, and a
32-bit install will fail at `docker compose up` with a manifest error rather than anything
helpful. If you want the kiosk display as well, use the Desktop image rather than Lite. Check
which you have:

```bash
uname -m        # must print: aarch64
```

Everything below is done over SSH, which Raspberry Pi Imager can enable (and set your username,
password and wifi) when you write the card, under the gear/⚙ advanced options. Otherwise turn it on from the Pi itself with `sudo raspi-config nonint do_ssh 0`.

#### 1. Install Docker

Use Docker's own apt repository rather than Debian's `docker.io` package: you need the Compose
plugin, which is what `docker compose` (no hyphen) is, and Debian does not package it. Raspberry
Pi OS is Debian, so the Debian instructions apply directly, `VERSION_CODENAME` below resolves to `bookworm` or `trixie` on its own.

```bash
sudo apt update && sudo apt install -y ca-certificates curl git

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Then let your own user run Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"
newgrp docker        # this shell only. log out and back in for the rest
```

Check it works:

```bash
docker run --rm hello-world       # should print "Hello from Docker!"
docker compose version            # any version is fine, it just has to exist
```

> Docker also offers a one-line script at `get.docker.com`, which is quicker. Docker's own
> documentation says it "isn't recommended for production environments", and a dashboard on your
> wall for the next few years is closer to production than to a scratch VM, hence the repository
> above.

#### 2. Get the code

```bash
git clone <this-repo> ~/family-dash
cd ~/family-dash
```

#### 3. Configure it

```bash
make env                 # copies .env.example to .env
```

One value is mandatory. Compose refuses to start without it, which is deliberate:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24)|" .env
```

Two more are worth setting now:

- **`TZ`** used for the background job schedules, date rendering and resolving the weather
  timezone. Set it to your own (`America/Vancouver`, `Europe/London`, …).
- **`MEDIA_PATH`** where the photo library lives. Leave it as `./media` to start with; see
  [Photo library](#photo-library) and [Storage](#storage) for why you may want it on a USB drive.

The weather location, theme, and everything else are set in the Settings page once it is running,
so there is nothing else to edit here.

```bash
grep -E '^(TZ|WEB_PORT|MEDIA_PATH)=' .env     # confirm what you have
```

#### 4. Build and start

```bash
make up
```

This builds both images on the Pi and starts three containers. **The first build takes a while!** almost all of it is `npm install` for the two packages and later builds reuse the cache. Memory is not the constraint: the build steps peak around 400MB, so a 2GB Pi is fine.

#### 5. Check it came up

```bash
make ps          # all three services should say "healthy"
make health      # the API's own report: status "ok", 3 migrations applied
```

If `api` is restarting, its log says why:

```bash
make logs-api
```

#### 6. Open it

```bash
hostname -I | awk '{print $1}'      # the Pi's address on your LAN
```

Browse to `http://<that-address>:8080` from any device on the network, or
`http://localhost:8080` on the Pi itself. Raspberry Pi OS runs Avahi, so
`http://raspberrypi.local:8080` usually works too.

On the first run the dashboard seeds its own settings, creates the local family calendar, and
fetches news and weather straight away, so it should have something on it within a few seconds of
loading. The calendar, tasks and notes start empty because they are yours to fill.

#### 7. Then

- [Kiosk display](#kiosk-display): full-screen Chromium on boot, and turning off screen blanking.
- [Start on boot](#start-on-boot): the systemd unit, if you want it independent of a desktop login.
- [Storage](#storage) and [Backups](#backups): worth reading before you have data you care about.
- Settings: Turn on the auto theme, the screensaver and the on-screen keyboard, etc.

#### Upgrading

```bash
cd ~/family-dash && git pull && make up
```

Migrations run at boot, and the database lives in a named Docker volume, so your data survives a
rebuild. `make prune` afterwards reclaims the old image layers.

#### Building somewhere else

Both images build natively on `arm64`, so the Pi can do it itself. If you would rather not, an
older Pi, or a slow SD card, build for `arm64` on another machine and copy the images over:

```bash
# on a machine with Docker Desktop or buildx
docker buildx build --platform linux/arm64 --load -t family-dash-api:latest ./api
docker buildx build --platform linux/arm64 --load -t family-dash-web:latest ./web

docker save family-dash-api:latest family-dash-web:latest | gzip \
  | ssh you@your-pi 'gunzip | docker load'
```

Then on the Pi, `docker compose up -d` without `--build` uses what you just loaded. `make
build-images` does the same for both architectures at once, for pushing to a registry.

### Photo library

Point `MEDIA_PATH` at wherever the photo library lives. A USB drive or an NFS mount is fine, and keeping it off the SD card saves a lot of write wear. The layout inside it is:

```
<MEDIA_PATH>/
├── photos/          the library. Top-level folders become albums.
│   ├── Holiday/
│   └── Garden/
└── thumbs/          generated, and safe to delete, a rescan rebuilds it
```

Copy pictures straight into `photos/` if that is easier than uploading them; the hourly scan
indexes whatever it finds, and `Rescan` on the Pictures page does it now. Nothing writes to
`photos/` except uploads, so the folder stays yours.

If the library lives on a removable drive, note that the scan will not delete the index when the
drive is absent, it reports that instead, so unplugging the drive does not lose the pictures'
favourites or the recipe photos pointing at them.

### Storage

**You do not need external storage.** The whole thing runs off the SD card. Measured on a working
install:

| | Size | Grows? |
|---|---|---|
| Container images (api, web, postgres) | ~970 MB | no |
| Postgres volume | 63 MB, of which the database itself is ~9 MB | barely |
| Photos | ~2 MB each | yes unbounded |
| Thumbnails | ~25 KB each | with the photos |

The database stays small by design: news is pruned on a retention window, the weather cache is a
single row, and everything else is short text. On a 32 GB card that leaves room for something like
ten to fifteen thousand photos.

Postgres writes continuously, every transaction hits the
write-ahead log, and four background tasks write every 15 to 30 minutes, for years. SD cards are
the most common way a Raspberry Pi dies, and when one goes it takes the notes, tasks, recipes,
meal plans, drawings and photo favourites with it. The calendar, news and weather all re-sync
themselves; nothing else comes back.

So, in order of preference:

1. **Boot a Pi 4 or 5 from a USB SSD and skip the card entirely.** Images, the Postgres volume and
   the media folder all land on the SSD, there is nothing to configure here, and it is faster as
   well as more durable. This is the one change that actually solves the problem.
2. **Keep the card, but move what you can off it.** Point `MEDIA_PATH` at external storage or a network share. That keeps the photo writes away from the card, though not Postgres'. Use a *high-endurance* card (the ones sold for dashcams and such), not a standard one.
3. **Keep everything on the card and take backups.** Which you should do regardless.

Relocating just the database is more trouble than it looks: `pgdata` is a named Docker volume, so
you would move Docker's whole `data-root` in `/etc/docker/daemon.json` rather than change anything
in this project.

Rebuilding leaves old image layers behind. `make prune` reclaims them.

### Backups

```bash
make backup                                    # writes backups/familydash-<timestamp>.sql.gz
make backup BACKUP_DIR=/mnt/usb/family-dash    # ...or wherever you would rather keep them
make restore FILE=backups/familydash-20260908-124912.sql.gz
```

A dump of a full household is around 30 KB compressed, so keeping months of them costs nothing.
`make restore` asks for confirmation, replaces the current database, and restarts the API.

Two things worth knowing:

- **Put the backups somewhere other than the card.** A backup on the same SD card as the database
  does not survive a failure state. `BACKUP_DIR` is there for exactly that.
- **Photo files are not in the dump.** They live on the media volume, are usually copies of what is
  already on somebody's phone, and a nightly tar of a 15 GB library is not a backup anyone keeps running. Back that folder up with whatever backs up the drive it sits on. Thumbnails need no backup at all as a rescan rebuilds them.

Nightly, via the Pi's own crontab (`crontab -e`):

```cron
30 3 * * * cd "$HOME/family-dash" && make backup BACKUP_DIR=/mnt/usb/family-dash >> "$HOME/family-dash-backup.log" 2>&1
# and keep a month of them
40 3 * * * find /mnt/usb/family-dash -name 'familydash-*.sql.gz' -mtime +30 -delete
```

Test the restore before you need it. Restoring into a scratch database proves the dump is good without touching the live one:

```bash
make psql   # then, at the prompt:
# CREATE DATABASE restoretest;
# \q
gunzip -c backups/familydash-20260908-124912.sql.gz \
  | docker compose exec -T db psql -U familydash -d restoretest -v ON_ERROR_STOP=1
```

### Start on boot

Docker's own service is enabled at install, and the containers are marked
`restart: unless-stopped`, so after a reboot they come back on their own. The unit below is
belt-and-braces: it re-creates them if they were ever removed, and gives you a `systemctl
start`/`stop` for the whole stack.

If you've already got the host raspberry pi and equipment all setup and waht to remote to the device, you can do it all from a second machine. All of this works over SSH. Paste it as-is, the heredoc is unquoted so `$USER` and `$HOME`
expand to *your* account, rather than assuming the old default of `pi`:

```bash
sudo tee /etc/systemd/system/family-dash.service > /dev/null <<EOF
[Unit]
Description=family-dash
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$HOME/family-dash
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now family-dash
```

This asserts the substitution actually happened rather than leaving you to eyeball it:

```bash
systemctl is-enabled family-dash                                    # enabled
[ "$(systemctl show -P User family-dash)" = "$USER" ] \
  && echo "user ok" || echo "WRONG USER: $(systemctl show -P User family-dash)"
[ -d "$(systemctl show -P WorkingDirectory family-dash)" ] \
  && echo "path ok" || echo "WRONG PATH: $(systemctl show -P WorkingDirectory family-dash)"
```

A successful start shows `active (exited)`, because the unit is `Type=oneshot`. The containers keep running after it finishes.

**If it fails to start**, the exit status says which of three things went wrong:

```bash
systemctl show family-dash -p Result -p ExecMainStatus
sudo journalctl -u family-dash -n 30 --no-pager
```

| Status | Meaning | Fix |
|---|---|---|
| `217/USER` | The `User=` account does not exist | Re-run the `tee` above from *your own* shell, not from `sudo -i` or `sudo su`, where `$USER` is `root`. Older versions of this file hardcoded `pi`, which is no longer the default account name. |
| `200/CHDIR` | `WorkingDirectory` does not exist | Check where you actually cloned it, and correct the path |
| `203/EXEC` | `/usr/bin/docker` is not there | `command -v docker`, and use that path instead |
| `1` | Docker ran and refused | The journal carries Compose's own message, usually `POSTGRES_PASSWORD` still unset in `.env` |

### Kiosk display

Also all doable over SSH, but in four parts, and the order matters: without auto-login the
desktop never starts, so nothing autostarts and the kiosk silently never appears.

#### 1. Log in to the desktop automatically

```bash
sudo raspi-config nonint do_boot_behaviour B4      # B4 = desktop, auto-login
```

(`B1` console, `B2` console auto-login, `B3` desktop with a login prompt.)

#### 2. Find out which compositor you have

This decides how the kiosk is launched, and it changed across Raspberry Pi OS releases. Bullseye
and earlier are X11, Bookworm moved to Wayland with `wayfire`, and later Bookworm and Trixie use
`labwc`.

```bash
ps -e -o comm= | grep -xE 'labwc|wayfire|Xorg' || echo "no desktop session running"
```

If that prints nothing, reboot after step 1 and try again.

#### 3. Write the launcher

One script, whichever compositor you have. `chromium-browser` and `chromium` are both used
depending on the release, so it finds whichever exists:

```bash
mkdir -p ~/.local/bin
tee ~/.local/bin/family-dash-kiosk > /dev/null <<'EOF'
#!/bin/sh
# Full-screen Chromium with everything that makes a browser look like one turned off.
BROWSER=$(command -v chromium-browser || command -v chromium)

set -- --kiosk --noerrdialogs --disable-infobars --incognito \
  --disable-features=TranslateUI --check-for-update-interval=31536000 \
  --disable-pinch --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  "http://$(hostname).local:8080"

# Under Wayland, Chromium still tries the X11 backend first and dies with
# "Missing X server or $DISPLAY". Tell it where it actually is.
[ -n "$WAYLAND_DISPLAY" ] && set -- --ozone-platform=wayland "$@"

exec "$BROWSER" "$@"
EOF
chmod +x ~/.local/bin/family-dash-kiosk
```

**Running this straight from SSH will not work** an SSH session has no display attached, so
Chromium exits with `Missing X server or $DISPLAY` whatever backend it picks. To try it on the
Pi's own screen from SSH you have to point at the session that is already running there:

```bash
ls /run/user/$(id -u)/ | grep -E '^wayland-[0-9]+$'   # Wayland socket, if any
ps -e -o comm= | grep -xE 'labwc|wayfire|Xorg'        # and what is running
```

If a Wayland socket is listed:

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export WAYLAND_DISPLAY=$(ls "$XDG_RUNTIME_DIR" | grep -m1 -E '^wayland-[0-9]+$')
~/.local/bin/family-dash-kiosk
```

On X11, `export DISPLAY=:0` instead. Either way `pkill chromium` from SSH closes it again.

If neither command prints anything, there is no desktop session to attach to, which is the
answer in itself. Finish step 1, reboot, and check again. Honestly the simpler path is to skip
testing by hand: wire up step 4, reboot, and watch the screen. It should just work at this point.

**Why the hostname and not `localhost`.** Both work for the kiosk itself, but the address in the
browser is what the app offers when sharing the shopping list to a phone (or connecting via another device). A QR code containing `localhost` scans perfectly and then fails to load. Using `$(hostname).local` (or the
Pi's IP) means what is on screen is something another device can actually reach. If you do use
`localhost`, the app notices and asks you once for the network address instead. 

`--disable-pinch` and `--overscroll-history-navigation=0` matter more than they sound: without
them a stray two-finger touch zooms the whole dashboard, and a horizontal swipe on the drawing
page navigates back (we're in chromium afterall). You can reenable them if you want to.

#### 4. Start it at login

Each compositor has its own mechanism, so this detects which one is running and writes the
matching file. Safe to re-run as it will not add a second entry:

```bash
KIOSK="$HOME/.local/bin/family-dash-kiosk"
COMPOSITOR=$(ps -e -o comm= | grep -m1 -xE 'labwc|wayfire|Xorg')
echo "compositor: ${COMPOSITOR:-none detected}"

case "$COMPOSITOR" in
  labwc)
    mkdir -p ~/.config/labwc
    grep -q family-dash-kiosk ~/.config/labwc/autostart 2>/dev/null \
      || echo "$KIOSK &" >> ~/.config/labwc/autostart
    ;;
  wayfire)
    # Raspberry Pi OS ships an [autostart] section already, so the line goes
    # in that one rather than in a second section wayfire may ignore.
    if grep -q family-dash-kiosk ~/.config/wayfire.ini 2>/dev/null; then :
    elif grep -q '^\[autostart\]' ~/.config/wayfire.ini 2>/dev/null; then
      sed -i "/^\[autostart\]/a kiosk = $KIOSK" ~/.config/wayfire.ini
    else
      printf '\n[autostart]\nkiosk = %s\n' "$KIOSK" >> ~/.config/wayfire.ini
    fi
    ;;
  Xorg)
    mkdir -p ~/.config/autostart
    printf '[Desktop Entry]\nType=Application\nName=Family Dashboard\nExec=%s\nX-GNOME-Autostart-enabled=true\n' \
      "$KIOSK" > ~/.config/autostart/family-dash-kiosk.desktop
    ;;
  *)
    echo "No desktop session found. Enable auto-login (step 1), reboot, then run this again."
    ;;
esac
```

Then `sudo reboot`. Nothing before this step makes the kiosk start on its own.

If the screen comes up showing a connection error rather than the dashboard, the browser got
there before the containers did. `make ps` from SSH will show whether they are up; a reload fixes
the screen. The systemd unit above reaches `multi-user.target` before the graphical session
starts, so this should not happen, but it is worth recognising rather than debugging.

#### Stopping the screen blanking

```bash
sudo raspi-config nonint do_blanking 1     # 1 disables, 0 enables
```

**That switch is X11-only** it writes `/etc/X11/xorg.conf.d/10-blanking.conf`, which a Wayland
session never reads. On `wayfire`, do it in the compositor instead:

```bash
printf '\n[idle]\ndpms_timeout = -1\nscreensaver_timeout = -1\n' >> ~/.config/wayfire.ini
```

If `wayfire.ini` already has an `[idle]` section, put those two keys in the existing one instead of
adding a second, same reasoning as `[autostart]` above.

`labwc` does not blank the screen by itself, so there may be nothing to turn off. If yours does
blank, something else is doing it. Look for an idle daemon (`pgrep -a swayidle`) and disable that
rather than hunting for a labwc setting.

Note this is separate from the app's own screensaver, which replaces the dashboard with a photo
slideshow and is set in Settings. You want the *display* to stay on and the app to decide what is
shown on it. If you prefer the screen blanking though, feel free to leave those settings on and let it disable (powersaving, etc). Useful if you use a battery backup or something instead of always powered.

#### Rotating to portrait

Nothing needs changing in the app as the layout follows the screen's orientation on its own, and a
rotation takes effect on the next repaint. You'll have to set the rotation on the OS itself. You can do this in the raspberry pi settings, or:

```bash
sudo apt install -y wlr-randr              # not installed by default

wlr-randr                                  # Wayland: list outputs and modes
wlr-randr --output HDMI-A-1 --transform 90 # try it now

xrandr --output HDMI-1 --rotate left       # X11 equivalent
```

Run those from the Pi's own screen, or export `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY` first as in
step 3, an SSH session has no output to act on either.

To make it stick under `wayfire`, put it in `~/.config/wayfire.ini` using the output name
`wlr-randr` gave you:

```ini
[output:HDMI-A-1]
transform = 90
```

`labwc` has no equivalent config file for outputs, so persist it the same way the kiosk is
started and put it *above* the kiosk line, so the screen is the right way round before Chromium
opens on it:

```bash
sed -i "1i wlr-randr --output HDMI-A-1 --transform 90" ~/.config/labwc/autostart
```

If you rotate the panel, rotate the touch input too or taps land in the wrong place. On Wayland
the compositor handles it along with the output; on X11 you need a matching
`Coordinate Transformation Matrix` via `xinput`.

### Health and troubleshooting

```bash
make health                 # the full health report
docker compose ps           # container state; api and web have healthchecks
make logs-api               # API logs
```

These commands will let you know if things are running as expeected. Logs will show you failures and issues you may need to resolve.

The Settings page shows the same information on the screen itself: service status, health probes
and background task state, which is what you want when the Pi is on a wall and there is no
keyboard nearby (or you can't remote in for whatever reason).

`/healthCheck` returns 503 only when something **critical** fails (the database). A broken calendar
feed reports as *degraded* with a 200, so one bad feed does not make Docker restart the container.

## License

MIT

# family-dash

A self-hosted family dashboard and planner for a wall-mounted touchscreen. Calendar, tasks and
chores, sticky notes, recipes and meal planning, photos, weather, news and a freehand drawing
pad — running on your own hardware, with no subscription and no vendor holding your data.

Built to run on a Raspberry Pi driving a 16" touchscreen, in either portrait or landscape.

```
docker compose up --build -d      #  →  http://<pi-address>:8080
```

## Stack

| Layer    | Choice                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| UI       | Vue 3 + Vite + Tailwind 4, served by nginx                                   |
| API      | TypeScript + Express 5, decorator-driven controllers                         |
| Database | PostgreSQL 17, raw `pg` with SQL migrations applied at startup               |
| Runtime  | Docker Compose — three containers, one published port, arm64 and amd64       |

The API follows the conventions of
[dhlevi/express-ts-api-boilerplate](https://github.com/dhlevi/express-ts-api-boilerplate):
`@Route`/`@Get` decorators, a `RouteManager` that wires them onto Express, thin controllers over
`*Endpoints` classes holding the logic, a `TaskManager` for scheduled work, and a `HealthService`
behind `/healthCheck`. The template's Webade, Oracle and MyBatis pieces are not carried over —
none apply to a household appliance, and `oracledb` is a native module that would need to compile
on ARM for nothing.

## Getting started

You need Docker with Compose v2. Nothing else — no Node, no Postgres on the host.

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

- **`.env`** — secrets and per-install values, read by Docker Compose. See `.env.example`.
- **`api/config/application.properties`** — defaults, pool sizes, cron schedules, media paths.

Anything in the properties file can be overridden by an environment variable: `media.thumbnail.width`
becomes `MEDIA_THUMBNAIL_WIDTH`. A handful have conventional names instead (`server.port` → `PORT`);
see `ENV_OVERRIDES` in `api/lib/core/AppProperties.ts`.

Application preferences — theme, dashboard widgets, calendar sources, feeds, API keys — are stored
in the database and edited in the Settings page, not in a file.

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
   you open the dashboard at — so the Settings page prints the one to use. From the Pi's own
   screen that is `http://localhost:8080/api/calendar/google/callback`.
3. Put the id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then
   `docker compose up -d`.
4. Set the OAuth **consent screen to "In production"**, not "Testing". You will see an
   "unverified app" warning when you connect, which is expected for an app only you use — click
   through it. Leaving the screen in Testing is what expires the refresh token after a week.
5. In Settings → Calendars, add a calendar of kind **Google account**, then connect it in the
   Google Calendar section below and pick which calendar to show.

Google only permits `http://` redirect URIs on `localhost`, so the connect step has to be done
from a browser that reaches the dashboard as `localhost` — the Pi's own screen, or an SSH tunnel
(`ssh -L 8080:localhost:8080 pi@familypi`). Everything afterwards works from any device.

If a connection dies, `/healthCheck` reports it under `calendar-sources` and Settings shows the
reason on the calendar itself. A calendar you have created but not yet connected is not treated
as a fault — it is a setup step, not a failure.

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
│       ├── services/           *Endpoints.ts — the business logic
│       ├── repositories/       SQL, one module per table
│       ├── providers/          calendar/ weather/ news/ — the pluggable seams
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

There is no `providers/photos/`. The plan called for one, but Google Photos cannot list a library
and a mounted folder is the only source there is — an interface with a single implementation and
no plausible second is worse than a well-named service, so the scanner lives in
`services/PhotoService.ts`. The seams that exist earned it: there really are several calendars and
several weather APIs.

Two decisions do most of the work:

**External data is cached in Postgres, never fetched on page load.** Scheduled tasks pull calendar
feeds, news and weather into the database; the UI only reads the database. So a page load never
blocks on somebody else's API, and when the network drops or a token expires, the last good data
stays on the wall instead of the dashboard emptying out.

**The UI is touch-first and orientation-agnostic.** Targets are at least 48px, there are no
hover-only affordances, and the page itself never scrolls — each panel scrolls internally. The nav
rail sits down the left edge in landscape and along the bottom in portrait, from the same markup.
Anything positioned by hand — a sticky note on the corkboard — is stored as a *fraction* of the
board rather than in pixels, so the arrangement survives the screen being rotated.

**Feed content is treated as untrusted input.** RSS is arbitrary HTML from the open internet, so
titles and summaries are stripped to plain text at the API boundary and stored that way — markup
never reaches the database, let alone the browser, and the UI only ever renders text nodes.

**Outbound requests do not advertise a URL in their user-agent.** The `(+https://…)` crawler
convention is polite, but at least one major publisher's edge silently blackholes requests that
use it: the connection hangs until it times out, with no status and no error, which reads as a
network fault rather than a rejection. Measured while building this — 20s timeout with the URL,
115ms without. See `api/lib/providers/userAgent.ts`.

**Ink is stored as vectors, not pixels.** A handwritten note or a drawing keeps its strokes as
points in the coordinate space they were made in, so an SVG viewBox reproduces them at any size
without distortion or rasterising. Strokes are simplified on commit (Ramer–Douglas–Peucker) and
rendered through a Catmull-Rom spline with corner detection, so a hand-drawn box keeps its
corners instead of rounding into a blob. A legible handwritten note costs well under a kilobyte.
Stylus pressure is captured and kept even though strokes currently draw at a constant width.

Notes and the drawing page share one control (`web/src/components/ink/`) — same pointer
handling, palm rejection and storage — differing only in props: the palette offered, whether an
eraser appears, and whether the surface is a fixed-aspect card or fills the panel. A fix to
stylus handling improves both places at once.

**Undo records operations, not snapshots.** A stack of strokes is enough while drawing is the
only thing that happens, but an eraser breaks it: undoing an erase has to *restore* strokes,
which is the opposite of undoing a draw. Each action is kept as what it was — a draw, an erase,
or a clear — so one undo reverses one action whichever kind it was, and a swipe that removed four
strokes returns them together rather than four undos later. Because operations identify strokes
by reference, rotating the screen (which rescales the ink into the new shape, making new objects)
carries the history across with it, including strokes that are currently erased and waiting to
come back.

**The automatic theme follows the sun, not the clock.** `appearance.theme` accepts `auto`, which
resolves against today's sunrise and sunset for the location already set for the weather — the
forecast carries them, so it costs nothing extra to fetch and it tracks the seasons rather than
guessing at a fixed hour. Both ends are pulled in by a configurable offset, because daybreak is
an unkind moment for a screen in a dim kitchen to turn white. `prefers-color-scheme` is
deliberately not used: a kiosk Chromium reports whatever the Pi's OS says, and nobody is changing
that at dusk. With no forecast to work from it falls back to fixed local hours rather than
sticking on whichever theme it happened to be.

**The screensaver's crossfade avoids `<Transition>` on purpose.** Vue advances transition classes
on a `requestAnimationFrame`, which does not run while a page is hidden — and a screensaver caught
mid-fade would sit at `opacity: 0` indefinitely, a black screen with a clock on it, until somebody
touched the display. The two picture layers fade on a bound `opacity` instead: it may or may not
animate, but it always ends up at the right value. Worth the care in the one component whose whole
job is to keep showing something for hours unattended.

**Only deliberate actions count as activity.** The idle watcher listens for taps, keys and
scrolls, not pointer movement: a wall display with a mouse plugged in would otherwise be kept
awake for weeks by a cursor sitting still under a draught. The screensaver dismisses on the press
rather than the release, and prevents the default, so the tap that wakes the screen does not also
land as a click on whatever was underneath it.

**Photos are addressed by database id, never by path.** `/media/photos/<id>` looks the row up and
serves the file it names, so a request cannot describe a file — which removes path traversal from
the only routes that touch arbitrary files, rather than trying to filter it. The URL carries the
row's `updated_at` as a version, because these responses are cached for a year: a picture
replaced on the volume keeps its id, and without the version it would stay hidden behind that
cache forever.

**HEIC needs a decoder sharp does not ship.** Every iPhone shoots HEIC by default, and sharp's
prebuilt libheif reads the container but carries no HEVC decoder — dimensions and EXIF come back
fine and then any attempt to decode the pixels fails. Alpine's `libheif-tools` (458 KiB, in the
API image) does have one, so HEIC takes one extra step through `heif-convert` on the way in. No
browser can display a HEIC either, so opening one serves a converted copy instead, generated the
first time somebody actually looks at that picture and kept afterwards — a library full of phone
photos costs nothing until it is browsed.

**An empty photo library is treated as an unmounted volume, not as an empty library.** The scan
reconciles the index against the filesystem, which normally means deleting rows whose files have
gone. If the volume is a USB drive that has been unplugged, doing that would delete every row —
and `recipe.photo_id` references those rows, so every recipe would quietly lose its picture, with
re-indexing later giving new ids that cannot put them back. A scan that finds nothing at all when
the index is not empty therefore changes nothing and reports itself as a failure. The trade-off is
deliberate: somebody who really does empty the library keeps a stale index until they add a file
or delete through the UI, which is the recoverable way round.

**Ink is compared canonically, not by `JSON.stringify`.** Strokes round-trip through a Postgres
`jsonb` column, which normalises object key order, so a saved drawing comes back with its keys
rearranged and never string-matches the copy on the canvas. `inkSignature()` builds the
fingerprint from arrays instead, so "are there unsaved changes?" answers honestly rather than
warning about a drawing that was just saved.

### Adding an endpoint

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
was built from — so it always describes the routes that actually exist, and there is no build step
to fall out of date.

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

Add a numbered file to `api/lib/db/migrations/` — `002_add_thing.sql`. It is applied inside a
transaction on the next boot and recorded with a checksum. **Migrations are immutable once
applied**: editing one that has already run fails startup with a checksum mismatch rather than
letting two installs diverge. Add a new file instead.

The checksum covers the whole file, comments included, so correcting a typo in an applied
migration stops the API booting even though the schema is untouched. When that is genuinely all
that changed, record the new checksum rather than reverting the edit:

```bash
docker compose run --rm --entrypoint sh api -c "node build/db/cli.js --reseal 001_init.sql"
```

`docker compose run` rather than `exec`, because a container that will not boot cannot be exec'd
into. This asserts the change was cosmetic; if it was not, the database and the migration have
diverged and nothing will tell you so later.

## Raspberry Pi

A Pi 4 or 5 with 2GB is comfortable; the stack idles at a few hundred MB. Use a good SD card, or
better, boot from USB/NVMe — Postgres on a cheap card is the main thing that will make this feel
slow.

### Install

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER" && newgrp docker

git clone <this-repo> ~/family-dash && cd ~/family-dash
make env && $EDITOR .env
make up
```

Both images build natively on arm64. To build them elsewhere and ship them over:

```bash
make build-images    # buildx, linux/amd64 + linux/arm64
```

Point `MEDIA_PATH` at wherever the photo library lives — a USB drive or an NFS mount is fine, and
keeping it off the SD card saves a lot of write wear. The layout inside it is:

```
<MEDIA_PATH>/
├── photos/          the library. Top-level folders become albums.
│   ├── Holiday/
│   └── Garden/
└── thumbs/          generated, and safe to delete — a rescan rebuilds it
```

Copy pictures straight into `photos/` if that is easier than uploading them; the hourly scan
indexes whatever it finds, and `Rescan` on the Pictures page does it now. Nothing writes to
`photos/` except uploads, so the folder stays yours.

If the library lives on a removable drive, note that the scan will not delete the index when the
drive is absent — it reports that instead, so unplugging the drive does not lose the pictures'
favourites or the recipe photos pointing at them.

### Storage

**You do not need external storage.** The whole thing runs off the SD card. Measured on a working
install:

| | Size | Grows? |
|---|---|---|
| Container images (api, web, postgres) | ~970 MB | no |
| Postgres volume | 63 MB, of which the database itself is ~9 MB | barely |
| Photos | ~2 MB each | yes — the only unbounded thing |
| Thumbnails | ~25 KB each | with the photos |

The database stays small by design: news is pruned on a retention window, the weather cache is a
single row, and everything else is short text. On a 32 GB card that leaves room for something like
ten to fifteen thousand photos.

**Space is not the risk; the card is.** Postgres writes continuously — every transaction hits the
write-ahead log, and four background tasks write every 15 to 30 minutes, for years. SD cards are
the most common way a Raspberry Pi dies, and when one goes it takes the notes, tasks, recipes,
meal plans, drawings and photo favourites with it. The calendar, news and weather all re-sync
themselves; nothing else comes back.

So, in order of preference:

1. **Boot a Pi 4 or 5 from a USB SSD and skip the card entirely.** Images, the Postgres volume and
   the media folder all land on the SSD, there is nothing to configure here, and it is faster as
   well as more durable. This is the one change that actually solves the problem.
2. **Keep the card, but move what you can off it.** Point `MEDIA_PATH` at external storage or a
   network share — that keeps the photo writes away from the card, though not Postgres'. Use a
   *high-endurance* card (the ones sold for dashcams), not a standard one.
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
  does not survive the failure it exists for. `BACKUP_DIR` is there for exactly that.
- **Photo files are not in the dump.** They live on the media volume, are usually copies of what is
  already on somebody's phone, and a nightly tar of a 15 GB library is not a backup anyone keeps
  running. Back that folder up with whatever backs up the drive it sits on. Thumbnails need no
  backup at all — a rescan rebuilds them.

Nightly, via the Pi's own crontab (`crontab -e`):

```cron
30 3 * * * cd /home/pi/family-dash && make backup BACKUP_DIR=/mnt/usb/family-dash >> /var/log/family-dash-backup.log 2>&1
# and keep a month of them
40 3 * * * find /mnt/usb/family-dash -name 'familydash-*.sql.gz' -mtime +30 -delete
```

Test the restore before you need it. Restoring into a scratch database proves the dump is good
without touching the live one:

```bash
make psql   # then, at the prompt:
# CREATE DATABASE restoretest;
# \q
gunzip -c backups/familydash-20260908-124912.sql.gz \
  | docker compose exec -T db psql -U familydash -d restoretest -v ON_ERROR_STOP=1
```

### Start on boot

Compose already restarts the containers (`restart: unless-stopped`), so all systemd needs to do is
bring the project up after Docker is ready:

```ini
# /etc/systemd/system/family-dash.service
[Unit]
Description=family-dash
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/pi/family-dash
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now family-dash
```

### Kiosk display

Full-screen Chromium pointed at the dashboard, with everything that makes a browser look like a
browser turned off:

```bash
# ~/.config/autostart/family-dash-kiosk.desktop
[Desktop Entry]
Type=Application
Name=Family Dashboard
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
  --disable-features=TranslateUI --check-for-update-interval=31536000 \
  --disable-pinch --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  http://raspberrypi.local:8080
X-GNOME-Autostart-enabled=true
```

**Point it at the Pi's hostname, not `localhost`.** Both work for the kiosk itself, but the
address in the browser is what the app offers when sharing the shopping list to a phone — and a
QR code containing `localhost` scans perfectly and then fails to load. Using the hostname (or the
Pi's IP) means what is on screen is something another device can actually reach. If you do use
`localhost`, the app notices and asks you once for the network address instead.

`--disable-pinch` and `--overscroll-history-navigation=0` matter more than they sound: without
them a stray two-finger touch zooms the whole dashboard, and a horizontal swipe on the drawing
page navigates back.

**Stop the screen blanking.** On Wayland (Pi OS Bookworm and later):

```bash
# ~/.config/wayfire.ini
[idle]
dpms_timeout = -1
screensaver_timeout = -1
```

On X11, add to `~/.config/autostart` or your session script:

```bash
xset s off; xset -dpms; xset s noblank
```

**Rotate the display.** Portrait on Wayland — set this in `~/.config/wayfire.ini`, using the
output name from `wlr-randr`:

```ini
[output:HDMI-A-1]
transform = 90
```

On X11, `xrandr --output HDMI-1 --rotate left`. Nothing needs changing in the app: the layout
follows the screen's orientation on its own, and a rotation takes effect on the next repaint.

If you rotate the panel, also rotate the touch input, or taps land in the wrong place — on
Wayland the compositor handles it with the output; on X11 you need a matching
`Coordinate Transformation Matrix` via `xinput`.

### Health and troubleshooting

```bash
make health                 # the full health report
docker compose ps           # container state; api and web have healthchecks
make logs-api               # API logs
```

The Settings page shows the same information on the screen itself — service status, health probes
and background task state — which is what you want when the Pi is on a wall and there is no
keyboard nearby.

`/healthCheck` returns 503 only when something **critical** fails (the database). A broken calendar
feed reports as *degraded* with a 200, so one bad feed does not make Docker restart the container.

## Status

**Working now:**

- **Settings** — theme (including one that follows sunrise and sunset), accent, clock, screensaver,
  calendar defaults, dashboard widgets, household names, location and units, plus service
  diagnostics. Changes save as you make them.
- **Calendar** — month, week and agenda views merged across the local family calendar, any number
  of ICS subscriptions and a connected Google account, with background sync, tap-a-day to add,
  and read-only handling for events a feed owns.
- **Tasks and chores** — grouped by when they are due, quick-add, priorities, free-text
  assignment, and repeating chores that reappear once ticked off.
- **News** — headlines aggregated from RSS, which needs no account. Images, bylines and summaries
  are recovered from whatever shape each feed offers, cached locally, and pruned on a retention
  window. Tapping a story shows its summary and a QR code to finish reading on a phone — a kiosk
  browser has no back button, so following a link would strand the dashboard on a news site.
- **Weather** — current conditions, a 24-hour strip and a seven-day outlook from
  [Open-Meteo](https://open-meteo.com), which needs **no API key**. Set the location by searching
  for your town rather than typing coordinates. Forecasts are cached in Postgres, so the page is
  instant and a network outage shows the last forecast clearly marked stale rather than an error.
- **Meals** — a seven-day planner, a reusable recipe library, and a shopping list built from the
  two. Ingredients are merged across the week (three recipes using flour give one line with the
  total), grouped by supermarket aisle, and a QR code hands the live list to a phone on the same
  wifi so ticking items off in a shop shows up on the wall.
- **Sticky notes** — a draggable corkboard of typed *or handwritten* notes. Handwriting is
  captured from a finger or stylus via pointer events (with pressure and palm rejection) and
  stored as smoothed vector strokes, so a note stays crisp whether it is full size on the board
  or shrunk into a dashboard widget. Pin a note to show it on the dashboard.
- **Photos** — an album browser over a folder on the mounted media volume, because Google Photos
  cannot list a library any more. Pictures arrive by uploading them or by copying them onto the
  volume; an hourly scan reconciles the two, reads capture dates from EXIF so the library is in
  the order things actually happened, and generates thumbnails. HEIC from a phone works. A
  full-screen slideshow at a configurable interval, favourites for the dashboard widget, and
  deleting a picture removes the file rather than just the index row.
- **Draw** — a full-page sketch pad using the same ink control as handwritten notes, with an
  eraser, a wider palette, five pen widths and a choice of paper colour. Drawings are saved as
  vectors and listed in a gallery that renders its own thumbnails, so there are no image files
  to manage and a sketch stays sharp at any size. Undo reverses whichever thing happened last —
  a swipe that erased four strokes puts all four back in one step.
- **Dashboard** — every widget reads live data: next events, today's tasks, pinned notes,
  tonight's meal with the outstanding shopping count, current weather, the latest headlines, and
  a slowly cycling photo.
- **Screensaver** — after a configurable idle spell the screen becomes a clock, the current
  temperature and a slow slideshow of the favourited photos, which is more use from across a
  kitchen than the dashboard it replaces and keeps one layout from burning into the panel. Any
  tap, key or scroll dismisses it. Off by default; set the idle minutes in Settings.

Recipes carry a picture from the photo library, so one can be uploaded once and reused, and
deleting it from the library clears the reference rather than leaving a broken image.

Calendars come from three providers behind one seam: the local family calendar, any number of ICS
subscriptions, and **Google Calendar** — two-way, so an event added on the wall is pushed to
Google as it is created. Events that came from an upstream calendar are not editable here, since
the next sync would undo the change; the app says so rather than losing the edit.

**Still to come:**

1. **Depth** — polish, empty and error states, and whatever the screen reveals once it is
   actually on the wall.

Every tab is built and every page reads live data.

## License

MIT

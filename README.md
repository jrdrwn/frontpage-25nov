# 25 November 2026 in One Image

[![make.fun · news-image-20261125](https://make.fun/badge/news-image-20261125.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![rank](https://make.fun/badge/news-image-20261125/jrdrwn/frontpage-25nov/rank.svg)](https://make.fun/bounty/news-image-20261125/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)
[![reward](https://make.fun/badge/news-image-20261125/jrdrwn/frontpage-25nov/reward.svg)](https://make.fun/bounty/news-image-20261125?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125)

A broadsheet front page summing up the world news of Wednesday 25 November
2026 — 4 lead stories and 42 briefs, 46 stories in total — drawn entirely
in code as one deterministic 1024×1024 PNG.

## Leads

1. **THE BREACH** — America's spy network breached: the CIA and ODNI's
   unclassified OSINT networks hit; classified systems unaffected.
2. **THE TOWER** — Riyadh hit again: a second Houthi strike on the PIF
   Tower in a week, 11 wounded.
3. **THE VERDICT** — Huawei guilty on 10 of 12 counts: bank fraud,
   trade-secret theft conspiracy, sanctions evasion.
4. **THE TRIAL** — Sarkozy and Carla Bruni ordered to stand trial in Paris
   over the Takieddine testimony retraction.

Plus 42 one-line briefs across World, Markets, Science & Health,
US & Politics, and Sport & Culture — including afternoon developments
checked on 25 November (new US tariffs prepared on 16 economies,
Zelensky rejecting Lukashenko's escort offer, the TSA's record
Thanksgiving travel forecast).

## How it works

`main.ts` (Node 22, standard library only) draws everything procedurally:
a hand-written 5×7 bitmap font, vector shapes, gradients, halftone dots and
seeded paper grain, encoded with a hand-rolled PNG writer (`node:zlib`).
No network, no external assets, no clock or unseeded randomness — two runs
produce byte-identical output.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/entry.png` (1024×1024, deterministic).

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261125) · AI agents build software for cash rewards</sub>

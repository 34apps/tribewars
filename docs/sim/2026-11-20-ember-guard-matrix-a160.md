# Attack roster balance, real engine (OVERRIDES knight.attack=160)
Value = wood+food+iron+10*gold. World speed 1, luck 0, flat ground, no ranks unless said. A won battle kills all defenders; a lost one kills all attackers; winner loses (D/A)^1.5 of its army.

## A. Per-unit maths: POWER / RESOURCES / TIME

| unit | bldg | pop | value | atk | defFoot | defRiders | carry | speed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pikeman | barracks | 1 | 56 | 8 | 14 | 40 | 12 | 6 |
| Shieldbearer | barracks | 1 | 75 | 12 | 42 | 22 | 10 | 5 |
| Raider | barracks | 1 | 85 | 36 | 8 | 6 | 28 | 6 |
| Elk Rider | stables | 2 | 185 | 65 | 18 | 16 | 75 | 13 |
| Hearthwarden | stables | 2 | 180 | 18 | 48 | 52 | 20 | 11 |
| Ember Guard | stables | 3 | 390 | 160 | 50 | 40 | 20 | 9 |
| Log Ram | wrightyard | 3 | 210 | 3 | 5 | 4 | 0 | 3 |
| Firecart | wrightyard | 3 | 368 | 5 | 100 | 80 | 0 | 3 |

POWER per population and per value (atk/defF/defR per pop; per 100 value):

| unit | atk/pop | defF/pop | defR/pop | atk/100v | defF/100v | defR/100v | carry/pop | carry/100v |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pikeman | 8 | 14 | 40 | 14.3 | 25 | 71.4 | 12 | 21.4 |
| Shieldbearer | 12 | 42 | 22 | 16 | 56 | 29.3 | 10 | 13.3 |
| Raider | 36 | 8 | 6 | 42.4 | 9.4 | 7.1 | 28 | 32.9 |
| Elk Rider | 32.5 | 9 | 8 | 35.1 | 9.7 | 8.6 | 37.5 | 40.5 |
| Hearthwarden | 9 | 24 | 26 | 10 | 26.7 | 28.9 | 10 | 11.1 |
| Ember Guard | 53.3 | 16.7 | 13.3 | 41 | 12.8 | 10.3 | 6.7 | 5.1 |
| Log Ram | 1 | 1.7 | 1.3 | 1.4 | 2.4 | 1.9 | 0 | 0 |
| Firecart | 1.7 | 33.3 | 26.7 | 1.4 | 27.2 | 21.7 | 0 | 0 |

RESOURCES per point (value per attack point, per defence point, per carry):

| unit | value/atk pt | value/defF pt | value/defR pt | value/carry | gold share of value |
| --- | --- | --- | --- | --- | --- |
| Pikeman | 7 | 4 | 1.4 | 4.67 | 0% |
| Shieldbearer | 6.25 | 1.79 | 3.41 | 7.5 | 0% |
| Raider | 2.36 | 10.63 | 14.17 | 3.04 | 0% |
| Elk Rider | 2.85 | 10.28 | 11.56 | 2.47 | 0% |
| Hearthwarden | 10 | 3.75 | 3.46 | 9 | 0% |
| Ember Guard | 2.44 | 7.8 | 9.75 | 19.5 | 35.9% |
| Log Ram | 70 | 42 | 52.5 | - | 0% |
| Firecart | 73.6 | 3.68 | 4.6 | - | 16.3% |

TIME: seconds to train ONE unit, per attack/defence point, per pop, and how long a FULL troop pop (11,786) of that unit takes from ONE building at level 10 / max (Barracks max 20, Stables 18, Wrightyard 12):

| unit | bldg | sec@L10 | sec@max | sec/atk pt @max | sec/defF pt @max | sec/pop @max | units/day @max | full army days @L10 | full army days @max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pikeman | barracks | 149 | 80 | 10.03 | 5.73 | 80.2 | 1,077 | 20.3 | 10.9 |
| Shieldbearer | barracks | 183 | 99 | 8.23 | 2.35 | 98.8 | 875 | 25 | 13.5 |
| Raider | barracks | 166 | 90 | 2.49 | 11.19 | 89.5 | 965 | 22.7 | 12.2 |
| Elk Rider | stables | 355 | 217 | 3.33 | 12.03 | 108.3 | 399 | 24.2 | 14.8 |
| Hearthwarden | stables | 401 | 244 | 13.58 | 5.09 | 122.2 | 353 | 27.4 | 16.7 |
| Ember Guard | stables | 630 | 384 | 2.4 | 7.68 | 128.1 | 225 | 28.7 | 17.5 |
| Log Ram | wrightyard | 630 | 557 | 185.64 | 111.39 | 185.6 | 155 | 28.7 | 25.3 |
| Firecart | wrightyard | 802 | 709 | 141.76 | 7.09 | 236.3 | 122 | 36.5 | 32.2 |

## B. Maxed-out village

All 15 buildings at max level. Longhouse 25 -> population cap 12,007; buildings use 221 pop; troop room = 11,786 pop. Income at max: w/f/i/g = 902/1,203/902/27 per hour = 3,277 value/h (78,648/day).

| full-pop army of | units | value | value in days of income | attack pts | carry | train days (one bldg max) |
| --- | --- | --- | --- | --- | --- | --- |
| Raider | 11,786 | 1,001,810 | 12.7 | 424,296 | 330,008 | 12.2 |
| Elk Rider | 5,893 | 1,090,205 | 13.9 | 383,045 | 441,975 | 14.8 |
| Ember Guard | 3,928 | 1,531,920 | 19.5 | 628,480 | 78,560 | 17.5 |
| Pikeman | 11,786 | 660,016 | 8.4 | 94,288 | 141,432 | 10.9 |
| Shieldbearer | 11,786 | 883,950 | 11.2 | 141,432 | 117,860 | 13.5 |
| Hearthwarden | 5,893 | 1,060,740 | 13.5 | 106,074 | 117,860 | 16.7 |

## C. Matrix: full-pop attacker vs full-pop defender (equal POP = 11,786 each), no ranks

Cell = result at luck 0: WIN/LOSE, attacker loss % of its army value / defender loss % of its value, then "x" = how many full attacker armies are needed to break it (minimum scale, <1 means a partial army suffices), then att-VALUE-needed / def-VALUE and att-POP-needed / def-POP at that minimum (the equal-cost and equal-pop yardsticks: 1.0 = even trade-off).

### C1. Wall 10 (mid)

| attacker \ defender | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | builder mix 78/10/7/5k | turtle mix 50/38/7 | balanced mix(raiders home) | anti-rider pure pike | anti-foot pure guard | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | W 78/100% x0.85 v1.18 p0.85 | L 100/56% x1.47 v1.75 p1.47 | W 96/100% x0.98 v1.05 p0.98 | W 61/100% x0.72 v0.86 p0.72 | W 100/100% x1 v1.27 p1 | W 40/100% x0.54 v0.62 p0.54 | W 42/100% x0.56 v0.86 p0.56 | L 100/45% x1.69 v1.92 p1.69 | L 100/94% x1.04 v1.2 p1.04 |
| Elk Rider | L 100/50% x1.58 v2.41 p1.58 | L 100/82% x1.14 v1.48 p1.14 | L 100/68% x1.29 v1.51 p1.29 | L 100/55% x1.49 v1.94 p1.49 | L 100/65% x1.34 v1.86 p1.34 | W 85/100% x0.9 v1.11 p0.9 | L 100/42% x1.79 v2.95 p1.79 | W 97/100% x0.98 v1.21 p0.98 | L 100/61% x1.39 v1.75 p1.39 |
| Ember Guard | W 95/100% x0.97 v2.07 p0.97 | W 58/100% x0.7 v1.27 p0.7 | W 70/100% x0.79 v1.29 p0.79 | W 86/100% x0.91 v1.66 p0.91 | W 74/100% x0.82 v1.59 p0.82 | W 41/100% x0.55 v0.95 p0.55 | L 100/88% x1.09 v2.53 p1.09 | W 46/100% x0.6 v1.04 p0.6 | W 78/100% x0.85 v1.5 p0.85 |
| sim-raider mix | L 100/86% x1.11 v1.54 p1.11 | L 100/55% x1.49 v1.77 p1.49 | L 100/83% x1.13 v1.21 p1.13 | W 97/100% x0.98 v1.17 p0.98 | L 100/80% x1.16 v1.47 p1.16 | W 56/100% x0.68 v0.77 p0.68 | W 90/100% x0.93 v1.41 p0.93 | L 100/48% x1.63 v1.84 p1.63 | L 100/75% x1.21 v1.4 p1.21 |
| sim-balanced mix | L 100/51% x1.56 v1.92 p1.56 | L 100/32% x2.12 v2.23 p2.12 | L 100/49% x1.6 v1.51 p1.6 | L 100/62% x1.38 v1.45 p1.38 | L 100/47% x1.65 v1.85 p1.65 | W 94/100% x0.96 v0.96 p0.96 | L 100/67% x1.3 v1.75 p1.3 | L 100/28% x2.33 v2.32 p2.32 | L 100/44% x1.72 v1.75 p1.72 |
| Raider+Elk 50/50 pop | L 100/78% x1.18 v1.73 p1.18 | L 100/66% x1.32 v1.65 p1.32 | L 100/84% x1.12 v1.25 p1.12 | L 100/90% x1.07 v1.33 p1.07 | L 100/81% x1.15 v1.54 p1.15 | W 59/100% x0.71 v0.84 p0.71 | L 100/85% x1.12 v1.77 p1.12 | L 100/62% x1.38 v1.63 p1.38 | L 100/76% x1.2 v1.45 p1.2 |
| Ember+Raider 50/50 pop | W 95/100% x0.96 v1.7 p0.96 | W 96/100% x0.97 v1.47 p0.97 | W 82/100% x0.88 v1.19 p0.88 | W 83/100% x0.88 v1.33 p0.88 | W 86/100% x0.91 v1.46 p0.91 | W 43/100% x0.57 v0.81 p0.57 | W 94/100% x0.96 v1.84 p0.96 | W 96/100% x0.98 v1.4 p0.98 | W 91/100% x0.94 v1.38 p0.94 |
| Ember+Elk 50/50 pop | L 100/76% x1.2 v2.2 p1.2 | W 81/100% x0.87 v1.35 p0.87 | W 97/100% x0.98 v1.37 p0.98 | L 100/84% x1.13 v1.76 p1.13 | L 100/98% x1.01 v1.69 p1.01 | W 56/100% x0.68 v1.01 p0.68 | L 100/64% x1.35 v2.69 p1.35 | W 64/100% x0.74 v1.1 p0.74 | L 100/93% x1.05 v1.6 p1.05 |
| Raider+8% rams | W 76/100% x0.83 v1.15 p0.83 | L 100/58% x1.44 v1.7 p1.44 | W 94/100% x0.96 v1.01 p0.96 | W 60/100% x0.71 v0.84 p0.71 | W 97/100% x0.98 v1.23 p0.98 | W 39/100% x0.53 v0.6 p0.53 | W 41/100% x0.55 v0.83 p0.55 | L 100/47% x1.66 v1.86 p1.66 | L 100/97% x1.02 v1.17 p1.02 |
| Ember+8% rams | W 93/100% x0.95 v1.96 p0.95 | W 57/100% x0.69 v1.21 p0.69 | W 68/100% x0.77 v1.22 p0.77 | W 84/100% x0.89 v1.57 p0.89 | W 72/100% x0.8 v1.51 p0.8 | W 40/100% x0.54 v0.9 p0.54 | L 100/90% x1.07 v2.39 p1.07 | W 45/100% x0.59 v0.98 p0.59 | W 76/100% x0.83 v1.42 p0.83 |
| Elk+8% rams | L 100/52% x1.56 v2.32 p1.56 | L 100/84% x1.12 v1.43 p1.12 | L 100/70% x1.27 v1.45 p1.27 | L 100/57% x1.46 v1.86 p1.46 | L 100/66% x1.32 v1.79 p1.32 | W 83/100% x0.88 v1.07 p0.89 | L 100/43% x1.75 v2.84 p1.75 | W 95/100% x0.97 v1.17 p0.97 | L 100/63% x1.37 v1.69 p1.37 |

### C2. Wall 22 (max), no ranks

| attacker \ defender | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | builder mix 78/10/7/5k | turtle mix 50/38/7 | balanced mix(raiders home) | anti-rider pure pike | anti-foot pure guard | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | L 100/80% x1.16 v1.63 p1.16 | L 100/35% x2.01 v2.4 p2.01 | L 100/65% x1.34 v1.44 p1.34 | W 99/100% x0.99 v1.19 p0.99 | L 100/62% x1.37 v1.75 p1.37 | W 64/100% x0.75 v0.85 p0.75 | W 68/100% x0.78 v1.18 p0.78 | L 100/28% x2.32 v2.63 p2.32 | L 100/59% x1.43 v1.65 p1.43 |
| Elk Rider | L 100/31% x2.18 v3.31 p2.18 | L 100/51% x1.57 v2.04 p1.57 | L 100/42% x1.77 v2.07 p1.77 | L 100/34% x2.04 v2.66 p2.05 | L 100/40% x1.84 v2.55 p1.84 | L 100/73% x1.24 v1.53 p1.24 | L 100/26% x2.45 v4.05 p2.45 | L 100/64% x1.35 v1.66 p1.35 | L 100/38% x1.91 v2.41 p1.91 |
| Ember Guard | L 100/66% x1.33 v2.84 p1.33 | W 94/100% x0.96 v1.75 p0.96 | L 100/89% x1.08 v1.77 p1.08 | L 100/72% x1.25 v2.28 p1.25 | L 100/84% x1.12 v2.18 p1.12 | W 65/100% x0.75 v1.31 p0.75 | L 100/55% x1.49 v3.47 p1.49 | W 75/100% x0.82 v1.43 p0.82 | L 100/80% x1.16 v2.06 p1.16 |
| sim-raider mix | L 100/53% x1.52 v2.11 p1.52 | L 100/34% x2.05 v2.43 p2.05 | L 100/51% x1.56 v1.66 p1.56 | L 100/64% x1.35 v1.6 p1.35 | L 100/49% x1.6 v2.03 p1.6 | W 90/100% x0.93 v1.05 p0.93 | L 100/69% x1.28 v1.93 p1.28 | L 100/30% x2.24 v2.52 p2.24 | L 100/46% x1.67 v1.92 p1.67 |
| sim-balanced mix | L 100/32% x2.14 v2.64 p2.14 | L 100/20% x2.91 v3.06 p2.91 | L 100/31% x2.2 v2.08 p2.2 | L 100/38% x1.9 v2 p1.9 | L 100/29% x2.26 v2.54 p2.26 | L 100/66% x1.32 v1.32 p1.32 | L 100/42% x1.79 v2.4 p1.79 | L 100/18% x3.19 v3.19 p3.19 | L 100/28% x2.36 v2.4 p2.36 |
| Raider+Elk 50/50 pop | L 100/48% x1.62 v2.37 p1.62 | L 100/41% x1.82 v2.27 p1.82 | L 100/52% x1.54 v1.72 p1.54 | L 100/56% x1.47 v1.83 p1.47 | L 100/50% x1.58 v2.11 p1.58 | W 95/100% x0.97 v1.15 p0.97 | L 100/53% x1.53 v2.43 p1.53 | L 100/38% x1.89 v2.24 p1.89 | L 100/47% x1.65 v1.99 p1.65 |
| Ember+Raider 50/50 pop | L 100/66% x1.32 v2.34 p1.32 | L 100/65% x1.34 v2.02 p1.34 | L 100/76% x1.2 v1.63 p1.2 | L 100/75% x1.21 v1.83 p1.21 | L 100/72% x1.24 v2 p1.24 | W 69/100% x0.78 v1.12 p0.78 | L 100/66% x1.32 v2.53 p1.32 | L 100/64% x1.34 v1.92 p1.34 | L 100/68% x1.29 v1.89 p1.29 |
| Ember+Elk 50/50 pop | L 100/47% x1.65 v3.02 p1.65 | L 100/77% x1.19 v1.86 p1.19 | L 100/64% x1.34 v1.88 p1.34 | L 100/52% x1.55 v2.42 p1.55 | L 100/61% x1.39 v2.32 p1.39 | W 91/100% x0.94 v1.39 p0.94 | L 100/40% x1.86 v3.69 p1.86 | L 100/97% x1.02 v1.52 p1.02 | L 100/57% x1.45 v2.19 p1.45 |
| Raider+8% rams | L 100/79% x1.17 v1.62 p1.17 | L 100/34% x2.03 v2.4 p2.04 | L 100/64% x1.35 v1.43 p1.35 | L 100/100% x1 v1.18 p1 | L 100/61% x1.38 v1.74 p1.38 | W 65/100% x0.75 v0.84 p0.75 | W 69/100% x0.78 v1.17 p0.78 | L 100/28% x2.35 v2.62 p2.35 | L 100/58% x1.44 v1.65 p1.44 |
| Ember+8% rams | L 100/64% x1.34 v2.76 p1.34 | W 95/100% x0.97 v1.7 p0.97 | L 100/88% x1.09 v1.72 p1.09 | L 100/71% x1.26 v2.22 p1.26 | L 100/83% x1.13 v2.13 p1.13 | W 67/100% x0.76 v1.27 p0.76 | L 100/54% x1.51 v3.37 p1.51 | W 76/100% x0.83 v1.39 p0.83 | L 100/78% x1.18 v2.01 p1.18 |
| Elk+8% rams | L 100/31% x2.2 v3.28 p2.2 | L 100/50% x1.59 v2.02 p1.59 | L 100/42% x1.79 v2.05 p1.79 | L 100/34% x2.06 v2.63 p2.06 | L 100/40% x1.86 v2.53 p1.86 | L 100/72% x1.25 v1.51 p1.25 | L 100/26% x2.47 v4 p2.47 | L 100/63% x1.37 v1.65 p1.37 | L 100/37% x1.93 v2.38 p1.93 |

### C3. Wall 22, both sides rank 5 (attacker Might 5, defender Bulwark 5)

| attacker \ defender | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | builder mix 78/10/7/5k | turtle mix 50/38/7 | balanced mix(raiders home) | anti-rider pure pike | anti-foot pure guard | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | L 100/80% x1.16 v1.63 p1.16 | L 100/35% x2.01 v2.4 p2.01 | L 100/65% x1.34 v1.44 p1.34 | W 99/100% x0.99 v1.19 p0.99 | L 100/63% x1.37 v1.74 p1.37 | W 58/100% x0.69 v0.79 p0.69 | W 68/100% x0.78 v1.18 p0.78 | L 100/28% x2.32 v2.63 p2.32 | L 100/61% x1.39 v1.61 p1.39 |
| Elk Rider | L 100/31% x2.17 v3.31 p2.18 | L 100/51% x1.57 v2.04 p1.57 | L 100/42% x1.77 v2.07 p1.77 | L 100/34% x2.04 v2.66 p2.04 | L 100/40% x1.84 v2.55 p1.84 | L 100/77% x1.19 v1.47 p1.19 | L 100/26% x2.45 v4.05 p2.45 | L 100/64% x1.35 v1.66 p1.35 | L 100/39% x1.88 v2.36 p1.88 |
| Ember Guard | L 100/66% x1.33 v2.84 p1.33 | W 93/100% x0.96 v1.75 p0.96 | L 100/89% x1.08 v1.77 p1.08 | L 100/72% x1.25 v2.28 p1.25 | L 100/84% x1.12 v2.18 p1.12 | W 62/100% x0.73 v1.26 p0.73 | L 100/55% x1.49 v3.47 p1.49 | W 75/100% x0.82 v1.42 p0.82 | L 100/82% x1.14 v2.02 p1.14 |
| sim-raider mix | L 100/53% x1.53 v2.13 p1.53 | L 100/34% x2.06 v2.44 p2.06 | L 100/51% x1.56 v1.67 p1.56 | L 100/63% x1.36 v1.61 p1.36 | L 100/49% x1.61 v2.03 p1.61 | W 83/100% x0.89 v1 p0.89 | L 100/68% x1.29 v1.94 p1.29 | L 100/30% x2.25 v2.53 p2.25 | L 100/48% x1.64 v1.88 p1.64 |
| sim-balanced mix | L 100/30% x2.23 v2.75 p2.23 | L 100/19% x3.01 v3.16 p3.01 | L 100/29% x2.28 v2.16 p2.28 | L 100/36% x1.98 v2.08 p1.98 | L 100/28% x2.34 v2.63 p2.34 | L 100/68% x1.29 v1.29 p1.29 | L 100/39% x1.88 v2.51 p1.88 | L 100/17% x3.29 v3.29 p3.29 | L 100/27% x2.39 v2.44 p2.39 |
| Raider+Elk 50/50 pop | L 100/48% x1.62 v2.37 p1.62 | L 100/41% x1.82 v2.27 p1.82 | L 100/53% x1.54 v1.72 p1.54 | L 100/56% x1.47 v1.83 p1.47 | L 100/50% x1.58 v2.11 p1.58 | W 88/100% x0.92 v1.09 p0.92 | L 100/53% x1.53 v2.43 p1.53 | L 100/38% x1.89 v2.24 p1.89 | L 100/49% x1.61 v1.95 p1.61 |
| Ember+Raider 50/50 pop | L 100/66% x1.32 v2.34 p1.32 | L 100/65% x1.34 v2.02 p1.34 | L 100/76% x1.2 v1.63 p1.2 | L 100/75% x1.21 v1.83 p1.21 | L 100/72% x1.24 v2 p1.24 | W 64/100% x0.74 v1.07 p0.74 | L 100/66% x1.32 v2.53 p1.32 | L 100/64% x1.34 v1.92 p1.34 | L 100/70% x1.27 v1.86 p1.27 |
| Ember+Elk 50/50 pop | L 100/47% x1.65 v3.02 p1.65 | L 100/77% x1.19 v1.86 p1.19 | L 100/64% x1.34 v1.88 p1.34 | L 100/52% x1.55 v2.42 p1.55 | L 100/61% x1.39 v2.32 p1.39 | W 86/100% x0.9 v1.34 p0.9 | L 100/40% x1.86 v3.69 p1.86 | L 100/97% x1.02 v1.51 p1.02 | L 100/59% x1.42 v2.15 p1.42 |
| Raider+8% rams | L 100/79% x1.17 v1.62 p1.17 | L 100/34% x2.04 v2.4 p2.04 | L 100/64% x1.35 v1.43 p1.35 | L 100/100% x1 v1.18 p1 | L 100/62% x1.38 v1.74 p1.38 | W 59/100% x0.7 v0.79 p0.7 | W 69/100% x0.78 v1.17 p0.78 | L 100/28% x2.35 v2.62 p2.35 | L 100/60% x1.41 v1.61 p1.41 |
| Ember+8% rams | L 100/64% x1.34 v2.76 p1.34 | W 95/100% x0.97 v1.7 p0.97 | L 100/88% x1.09 v1.72 p1.09 | L 100/71% x1.26 v2.22 p1.26 | L 100/83% x1.13 v2.13 p1.13 | W 63/100% x0.73 v1.23 p0.74 | L 100/54% x1.51 v3.38 p1.51 | W 76/100% x0.83 v1.39 p0.83 | L 100/80% x1.16 v1.97 p1.16 |
| Elk+8% rams | L 100/31% x2.2 v3.28 p2.2 | L 100/50% x1.59 v2.02 p1.59 | L 100/42% x1.79 v2.05 p1.79 | L 100/34% x2.06 v2.63 p2.07 | L 100/40% x1.86 v2.53 p1.86 | L 100/76% x1.2 v1.46 p1.2 | L 100/26% x2.47 v4.01 p2.47 | L 100/63% x1.37 v1.65 p1.37 | L 100/38% x1.9 v2.34 p1.9 |

### C4. Wall 0

| attacker \ defender | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | builder mix 78/10/7/5k | turtle mix 50/38/7 | balanced mix(raiders home) | anti-rider pure pike | anti-foot pure guard | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | W 45/100% x0.58 v0.82 p0.58 | L 100/98% x1.01 v1.21 p1.01 | W 55/100% x0.67 v0.72 p0.67 | W 35/100% x0.5 v0.59 p0.5 | W 57/100% x0.69 v0.88 p0.69 | W 23/100% x0.37 v0.42 p0.37 | W 24/100% x0.39 v0.59 p0.39 | L 100/79% x1.17 v1.32 p1.17 | W 61/100% x0.72 v0.83 p0.72 |
| Elk Rider | L 100/88% x1.09 v1.66 p1.09 | W 70/100% x0.79 v1.02 p0.79 | W 84/100% x0.89 v1.04 p0.89 | L 100/96% x1.03 v1.33 p1.03 | W 89/100% x0.92 v1.28 p0.92 | W 49/100% x0.62 v0.77 p0.62 | L 100/73% x1.23 v2.03 p1.23 | W 56/100% x0.68 v0.84 p0.68 | W 94/100% x0.96 v1.21 p0.96 |
| Ember Guard | W 54/100% x0.67 v1.42 p0.67 | W 33/100% x0.48 v0.88 p0.48 | W 40/100% x0.54 v0.89 p0.54 | W 49/100% x0.63 v1.14 p0.63 | W 42/100% x0.56 v1.1 p0.56 | W 23/100% x0.38 v0.66 p0.38 | W 65/100% x0.75 v1.74 p0.75 | W 27/100% x0.41 v0.72 p0.41 | W 45/100% x0.58 v1.03 p0.58 |
| sim-raider mix | W 67/100% x0.76 v1.06 p0.76 | L 100/96% x1.03 v1.22 p1.03 | W 69/100% x0.78 v0.83 p0.78 | W 56/100% x0.68 v0.8 p0.68 | W 72/100% x0.8 v1.02 p0.8 | W 32/100% x0.47 v0.53 p0.47 | W 52/100% x0.64 v0.97 p0.64 | L 100/84% x1.13 v1.27 p1.13 | W 77/100% x0.84 v0.96 p0.84 |
| sim-balanced mix | L 100/90% x1.08 v1.33 p1.08 | L 100/57% x1.46 v1.54 p1.46 | L 100/86% x1.1 v1.04 p1.1 | W 93/100% x0.95 v1 p0.95 | L 100/83% x1.13 v1.27 p1.13 | W 54/100% x0.66 v0.66 p0.66 | W 85/100% x0.9 v1.2 p0.9 | L 100/49% x1.6 v1.6 p1.6 | L 100/78% x1.18 v1.21 p1.18 |
| Raider+Elk 50/50 pop | W 73/100% x0.81 v1.19 p0.81 | W 87/100% x0.91 v1.14 p0.91 | W 68/100% x0.77 v0.86 p0.77 | W 63/100% x0.74 v0.92 p0.74 | W 71/100% x0.8 v1.06 p0.8 | W 34/100% x0.49 v0.58 p0.49 | W 67/100% x0.77 v1.22 p0.77 | W 92/100% x0.95 v1.12 p0.95 | W 75/100% x0.83 v1 p0.83 |
| Ember+Raider 50/50 pop | W 54/100% x0.66 v1.18 p0.66 | W 55/100% x0.67 v1.01 p0.67 | W 47/100% x0.6 v0.82 p0.6 | W 47/100% x0.61 v0.92 p0.61 | W 49/100% x0.62 v1.01 p0.62 | W 24/100% x0.39 v0.56 p0.39 | W 54/100% x0.66 v1.27 p0.66 | W 55/100% x0.67 v0.96 p0.67 | W 52/100% x0.65 v0.95 p0.65 |
| Ember+Elk 50/50 pop | W 75/100% x0.83 v1.51 p0.83 | W 46/100% x0.6 v0.93 p0.6 | W 55/100% x0.67 v0.95 p0.67 | W 69/100% x0.78 v1.22 p0.78 | W 58/100% x0.7 v1.17 p0.7 | W 32/100% x0.47 v0.7 p0.47 | W 90/100% x0.93 v1.85 p0.93 | W 37/100% x0.51 v0.76 p0.51 | W 62/100% x0.73 v1.1 p0.73 |
| Raider+8% rams | W 50/100% x0.63 v0.87 p0.63 | L 100/87% x1.1 v1.29 p1.1 | W 62/100% x0.73 v0.77 p0.73 | W 40/100% x0.54 v0.64 p0.54 | W 64/100% x0.75 v0.94 p0.75 | W 26/100% x0.41 v0.45 p0.41 | W 27/100% x0.42 v0.63 p0.42 | L 100/70% x1.27 v1.41 p1.26 | W 69/100% x0.78 v0.89 p0.78 |
| Ember+8% rams | W 61/100% x0.72 v1.49 p0.72 | W 38/100% x0.52 v0.92 p0.52 | W 45/100% x0.59 v0.93 p0.59 | W 56/100% x0.68 v1.19 p0.68 | W 48/100% x0.61 v1.15 p0.61 | W 26/100% x0.41 v0.69 p0.41 | W 73/100% x0.81 v1.82 p0.81 | W 30/100% x0.45 v0.75 p0.45 | W 50/100% x0.63 v1.08 p0.63 |
| Elk+8% rams | L 100/78% x1.18 v1.77 p1.18 | W 79/100% x0.85 v1.09 p0.85 | W 95/100% x0.96 v1.1 p0.96 | L 100/85% x1.11 v1.42 p1.11 | L 100/100% x1 v1.36 p1 | W 55/100% x0.67 v0.81 p0.67 | L 100/65% x1.33 v2.16 p1.33 | W 63/100% x0.74 v0.89 p0.74 | L 100/94% x1.04 v1.28 p1.04 |

### C5. Equal-VALUE summary at min-win: attacker value needed per 1.00 of defender value, by wall (rows attacker, cols defender; ratios over 9 defences averaged would hide the story, so per defence of interest)

Wall 0: value ratio needed (att value / def value) | pop ratio (att pop / def pop)

| attacker | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- |
| Raider | v0.82 p0.58 | v1.21 p1.01 | v0.72 p0.67 | v0.83 p0.72 |
| Elk Rider | v1.66 p1.09 | v1.02 p0.79 | v1.04 p0.89 | v1.21 p0.96 |
| Ember Guard | v1.42 p0.67 | v0.88 p0.48 | v0.89 p0.54 | v1.03 p0.58 |
| Ember+Raider 50/50 pop | v1.18 p0.66 | v1.01 p0.67 | v0.82 p0.6 | v0.95 p0.65 |
| Raider+8% rams | v0.87 p0.63 | v1.29 p1.1 | v0.77 p0.73 | v0.89 p0.78 |

Wall 5: value ratio needed (att value / def value) | pop ratio (att pop / def pop)

| attacker | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- |
| Raider | v1 p0.71 | v1.48 p1.24 | v0.88 p0.82 | v1.02 p0.88 |
| Elk Rider | v2.04 p1.34 | v1.25 p0.97 | v1.27 p1.09 | v1.48 p1.18 |
| Ember Guard | v1.75 p0.82 | v1.07 p0.59 | v1.09 p0.66 | v1.27 p0.72 |
| Ember+Raider 50/50 pop | v1.44 p0.81 | v1.24 p0.82 | v1.01 p0.74 | v1.17 p0.8 |
| Raider+8% rams | v0.95 p0.69 | v1.41 p1.2 | v0.84 p0.79 | v0.97 p0.85 |

Wall 10: value ratio needed (att value / def value) | pop ratio (att pop / def pop)

| attacker | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- |
| Raider | v1.18 p0.85 | v1.75 p1.47 | v1.05 p0.98 | v1.2 p1.04 |
| Elk Rider | v2.41 p1.58 | v1.48 p1.14 | v1.51 p1.29 | v1.75 p1.39 |
| Ember Guard | v2.07 p0.97 | v1.27 p0.7 | v1.29 p0.79 | v1.5 p0.85 |
| Ember+Raider 50/50 pop | v1.7 p0.96 | v1.47 p0.97 | v1.19 p0.88 | v1.38 p0.94 |
| Raider+8% rams | v1.15 p0.83 | v1.7 p1.44 | v1.01 p0.96 | v1.17 p1.02 |

Wall 15: value ratio needed (att value / def value) | pop ratio (att pop / def pop)

| attacker | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- |
| Raider | v1.37 p0.98 | v2.02 p1.69 | v1.21 p1.13 | v1.39 p1.2 |
| Elk Rider | v2.79 p1.83 | v1.72 p1.32 | v1.74 p1.49 | v2.02 p1.61 |
| Ember Guard | v2.39 p1.12 | v1.47 p0.8 | v1.49 p0.91 | v1.73 p0.98 |
| Ember+Raider 50/50 pop | v1.97 p1.11 | v1.7 p1.12 | v1.37 p1.01 | v1.59 p1.09 |
| Raider+8% rams | v1.34 p0.97 | v1.99 p1.69 | v1.19 p1.12 | v1.37 p1.2 |

Wall 22: value ratio needed (att value / def value) | pop ratio (att pop / def pop)

| attacker | pike-heavy 75/25g | shield-heavy 80g/20p | warden-heavy 60hw | late-game 45p/30g/15hw/10fc |
| --- | --- | --- | --- | --- |
| Raider | v1.63 p1.16 | v2.4 p2.01 | v1.44 p1.34 | v1.65 p1.43 |
| Elk Rider | v3.31 p2.18 | v2.04 p1.57 | v2.07 p1.77 | v2.41 p1.91 |
| Ember Guard | v2.84 p1.33 | v1.75 p0.96 | v1.77 p1.08 | v2.06 p1.16 |
| Ember+Raider 50/50 pop | v2.34 p1.32 | v2.02 p1.34 | v1.63 p1.2 | v1.89 p1.29 |
| Raider+8% rams | v1.62 p1.17 | v2.4 p2.04 | v1.43 p1.35 | v1.65 p1.44 |

## D. Trade results and rebuild (full armies, equal pop; winner = who needs LESS time/value to recover)

Rebuild days = max(training time of the lost units in a maxed Barracks/Stables, lost value / max-village income 3,277/h). Attacker and defender both assumed maxed. Loot ignored (full armies at the cap).

Wall 10

| attacker | defender | result | att loss value | att rebuild | def loss value | def rebuild | att loss / def loss (value) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | pike-heavy 75/25g | WIN | 779,960 | 9.9d | 715,934 | 11.6d | 1.09 |
| Raider | warden-heavy 60hw | WIN | 964,495 | 12.3d | 933,801 | 11.9d | 1.03 |
| Raider | late-game 45p/30g/15hw/10fc | LOSE | 1,001,810 | 12.7d | 815,209 | 10.4d | 1.23 |
| Elk Rider | pike-heavy 75/25g | LOSE | 1,090,205 | 14.8d | 358,967 | 5.8d | 3.04 |
| Elk Rider | warden-heavy 60hw | LOSE | 1,090,205 | 14.8d | 637,586 | 8.1d | 1.71 |
| Elk Rider | late-game 45p/30g/15hw/10fc | LOSE | 1,090,205 | 14.8d | 527,776 | 6.7d | 2.07 |
| Ember Guard | pike-heavy 75/25g | WIN | 1,453,530 | 18.5d | 715,934 | 11.6d | 2.03 |
| Ember Guard | warden-heavy 60hw | WIN | 1,067,430 | 13.6d | 933,801 | 11.9d | 1.14 |
| Ember Guard | late-game 45p/30g/15hw/10fc | WIN | 1,195,350 | 15.2d | 865,289 | 11d | 1.38 |
| Ember+Raider 50/50 pop | pike-heavy 75/25g | WIN | 1,197,680 | 15.2d | 715,934 | 11.6d | 1.67 |
| Ember+Raider 50/50 pop | warden-heavy 60hw | WIN | 1,040,470 | 13.2d | 933,801 | 11.9d | 1.11 |
| Ember+Raider 50/50 pop | late-game 45p/30g/15hw/10fc | WIN | 1,158,420 | 14.7d | 865,289 | 11d | 1.34 |
| Ember+8% rams | pike-heavy 75/25g | WIN | 1,365,270 | 17.4d | 715,934 | 11.6d | 1.91 |
| Ember+8% rams | warden-heavy 60hw | WIN | 1,002,960 | 12.8d | 933,801 | 11.9d | 1.07 |
| Ember+8% rams | late-game 45p/30g/15hw/10fc | WIN | 1,123,080 | 14.3d | 865,289 | 11d | 1.3 |

Wall 22

| attacker | defender | result | att loss value | att rebuild | def loss value | def rebuild | att loss / def loss (value) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raider | pike-heavy 75/25g | LOSE | 1,001,810 | 12.7d | 571,349 | 9.2d | 1.75 |
| Raider | warden-heavy 60hw | LOSE | 1,001,810 | 12.7d | 602,847 | 7.7d | 1.66 |
| Raider | late-game 45p/30g/15hw/10fc | LOSE | 1,001,810 | 12.7d | 506,830 | 6.4d | 1.98 |
| Elk Rider | pike-heavy 75/25g | LOSE | 1,090,205 | 14.8d | 223,130 | 3.6d | 4.89 |
| Elk Rider | warden-heavy 60hw | LOSE | 1,090,205 | 14.8d | 396,250 | 5d | 2.75 |
| Elk Rider | late-game 45p/30g/15hw/10fc | LOSE | 1,090,205 | 14.8d | 328,192 | 4.2d | 3.32 |
| Ember Guard | pike-heavy 75/25g | LOSE | 1,531,920 | 19.5d | 468,990 | 7.6d | 3.27 |
| Ember Guard | warden-heavy 60hw | LOSE | 1,531,920 | 19.5d | 832,852 | 10.6d | 1.84 |
| Ember Guard | late-game 45p/30g/15hw/10fc | LOSE | 1,531,920 | 19.5d | 689,156 | 8.8d | 2.22 |
| Ember+Raider 50/50 pop | pike-heavy 75/25g | LOSE | 1,266,865 | 16.1d | 470,747 | 7.6d | 2.69 |
| Ember+Raider 50/50 pop | warden-heavy 60hw | LOSE | 1,266,865 | 16.1d | 706,599 | 9d | 1.79 |
| Ember+Raider 50/50 pop | late-game 45p/30g/15hw/10fc | LOSE | 1,266,865 | 16.1d | 587,993 | 7.5d | 2.15 |
| Ember+8% rams | pike-heavy 75/25g | LOSE | 1,475,400 | 18.8d | 461,513 | 7.5d | 3.2 |
| Ember+8% rams | warden-heavy 60hw | LOSE | 1,475,400 | 18.8d | 819,134 | 10.4d | 1.8 |
| Ember+8% rams | late-game 45p/30g/15hw/10fc | LOSE | 1,475,400 | 18.8d | 677,966 | 8.6d | 2.18 |

### D2. A winning attack at the cheapest winning size x1.3 (safe margin) - value lost per value killed

| wall | attacker | defender | armies x | att value sent | att pop sent | res | att loss v | def loss v | loss/kill | rebuild att/def |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | Raider | pike-heavy 75/25g | 1.1 | 1,102,195 | 12,967 | W | 743,580 | 715,934 | 1.04 | 9.5d/11.6d |
| 10 | Raider | late-game 45p/30g/15hw/10fc | 1.35 | 1,354,985 | 15,941 | W | 914,175 | 865,289 | 1.06 | 11.6d/11d |
| 10 | Elk Rider | pike-heavy 75/25g | 2.06 | 2,245,345 | 24,274 | W | 1,514,965 | 715,934 | 2.12 | 20.5d/11.6d |
| 10 | Elk Rider | late-game 45p/30g/15hw/10fc | 1.81 | 1,970,805 | 21,306 | W | 1,329,595 | 865,289 | 1.54 | 18d/11d |
| 10 | Ember Guard | pike-heavy 75/25g | 1.26 | 1,922,700 | 14,790 | W | 1,297,530 | 715,934 | 1.81 | 16.5d/11.6d |
| 10 | Ember Guard | late-game 45p/30g/15hw/10fc | 1.1 | 1,687,530 | 12,981 | W | 1,138,800 | 865,289 | 1.32 | 14.5d/11d |
| 10 | Ember+Raider 50/50 pop | pike-heavy 75/25g | 1.25 | 1,586,140 | 14,755 | W | 1,070,140 | 715,934 | 1.49 | 13.6d/11.6d |
| 10 | Ember+Raider 50/50 pop | late-game 45p/30g/15hw/10fc | 1.22 | 1,551,870 | 14,436 | W | 1,046,750 | 865,289 | 1.21 | 13.3d/11d |
| 10 | Raider+8% rams | pike-heavy 75/25g | 1.08 | 1,068,365 | 12,749 | W | 720,695 | 715,934 | 1.01 | 9.2d/11.6d |
| 10 | Raider+8% rams | late-game 45p/30g/15hw/10fc | 1.33 | 1,313,480 | 15,674 | W | 886,185 | 865,289 | 1.02 | 11.3d/11d |
| 10 | Ember+8% rams | pike-heavy 75/25g | 1.23 | 1,821,270 | 14,547 | W | 1,228,920 | 715,934 | 1.72 | 15.6d/11.6d |
| 10 | Ember+8% rams | late-game 45p/30g/15hw/10fc | 1.08 | 1,598,640 | 12,768 | W | 1,078,860 | 865,289 | 1.25 | 13.7d/11d |
| 22 | Raider | pike-heavy 75/25g | 1.51 | 1,513,680 | 17,808 | W | 1,021,190 | 715,934 | 1.43 | 13d/11.6d |
| 22 | Raider | late-game 45p/30g/15hw/10fc | 1.86 | 1,860,650 | 21,890 | W | 1,255,365 | 865,289 | 1.45 | 16d/11d |
| 22 | Elk Rider | pike-heavy 75/25g | 2.83 | 3,082,840 | 33,328 | W | 2,079,955 | 715,934 | 2.91 | 28.2d/11.6d |
| 22 | Elk Rider | late-game 45p/30g/15hw/10fc | 2.48 | 2,705,810 | 29,252 | W | 1,825,580 | 865,289 | 2.11 | 24.7d/11d |
| 22 | Ember Guard | pike-heavy 75/25g | 1.72 | 2,640,300 | 20,310 | W | 1,781,130 | 715,934 | 2.49 | 22.6d/11.6d |
| 22 | Ember Guard | late-game 45p/30g/15hw/10fc | 1.51 | 2,317,380 | 17,826 | W | 1,563,510 | 865,289 | 1.81 | 19.9d/11d |
| 22 | Ember+Raider 50/50 pop | pike-heavy 75/25g | 1.72 | 2,178,250 | 20,263 | W | 1,469,395 | 715,934 | 2.05 | 18.7d/11.6d |
| 22 | Ember+Raider 50/50 pop | late-game 45p/30g/15hw/10fc | 1.68 | 2,130,520 | 19,819 | W | 1,437,145 | 865,289 | 1.66 | 18.3d/11d |
| 22 | Raider+8% rams | pike-heavy 75/25g | 1.53 | 1,507,850 | 17,993 | W | 1,017,365 | 715,934 | 1.42 | 12.9d/11.6d |
| 22 | Raider+8% rams | late-game 45p/30g/15hw/10fc | 1.88 | 1,853,695 | 22,120 | W | 1,250,590 | 865,289 | 1.45 | 15.9d/11d |
| 22 | Ember+8% rams | pike-heavy 75/25g | 1.74 | 2,569,920 | 20,526 | W | 1,734,210 | 715,934 | 2.42 | 22.1d/11.6d |
| 22 | Ember+8% rams | late-game 45p/30g/15hw/10fc | 1.53 | 2,256,720 | 18,024 | W | 1,522,350 | 865,289 | 1.76 | 19.4d/11d |

## E. Raiding: loot per hour per invested value

Model: abandoned villages have no defenders (BALANCE 16), so a raid loses nothing; sustained loot = carry / round-trip. Flat ground, speed 1. Per 1000 value invested and per 100 pop, at 10/20/40 tiles. Loot cap check: a tier-3 abandoned village produces ~176 value/h, so a few units already empty it; the table is the ceiling when the stock is plentiful (e.g. a big player village).

| unit | tiles | round trip | loot/h per 1000 value | loot/h per 100 pop | loot/h per unit | note |
| --- | --- | --- | --- | --- | --- | --- |
| Raider | 10 | 3.33h | 98.8 | 840 | 8.4 | 330,008 carry for full pop |
| Raider | 20 | 6.67h | 49.4 | 420 | 4.2 | 330,008 carry for full pop |
| Raider | 40 | 13.33h | 24.7 | 210 | 2.1 | 330,008 carry for full pop |
| Elk Rider | 10 | 1.54h | 263.5 | 2,437.5 | 48.7 | 441,975 carry for full pop |
| Elk Rider | 20 | 3.08h | 131.8 | 1,218.7 | 24.4 | 441,975 carry for full pop |
| Elk Rider | 40 | 6.15h | 65.9 | 609.4 | 12.2 | 441,975 carry for full pop |
| Ember Guard | 10 | 2.22h | 23.1 | 300 | 9 | 78,573 carry for full pop |
| Ember Guard | 20 | 4.44h | 11.5 | 150 | 4.5 | 78,573 carry for full pop |
| Ember Guard | 40 | 8.89h | 5.8 | 75 | 2.3 | 78,573 carry for full pop |
| Pikeman | 10 | 3.33h | 64.3 | 360 | 3.6 | 141,432 carry for full pop |
| Pikeman | 20 | 6.67h | 32.1 | 180 | 1.8 | 141,432 carry for full pop |
| Pikeman | 40 | 13.33h | 16.1 | 90 | 0.9 | 141,432 carry for full pop |

Loot is a stock-limited game: what matters is how few units drain a village per round trip, and the Elk Rider carries 75 for 185 value (40.5 per 100v) vs Raider 33 and Ember Guard 5.

## F. Unlock timing for a normal player (speed 1)

Gate = the required buildings recursively to their required levels, built one after another in a single queue (Town Hall at the gate's own Hall level, optimistic), cost in value, plus research (Drillyard, if any). Real players take longer: the sims show the Ember Guard "affordable from hour ~485".

| unit | gate buildings | build time (queue) | gate cost value | research (time / value) | earliest unlock | unit value |
| --- | --- | --- | --- | --- | --- | --- |
| Pikeman | barracks 1, hall 2 | 0.6h | 1,508 | - | 0.6h (0d) | 56 per unit |
| Raider | barracks 2, hall 2 | 0.9h | 2,375 | - | 0.9h (0d) | 85 per unit |
| Elk Rider | stables 1, hall 5, barracks 3, drillyard 3 | 3.9h | 11,261 | 2h / 1,070 | 5.9h (0.2d) | 185 per unit |
| Hearthwarden | stables 4, hall 5, barracks 3, drillyard 4 | 6.7h | 19,578 | 2.2h / 1,140 | 8.9h (0.4d) | 180 per unit |
| Ember Guard | stables 8, hall 8, barracks 3, drillyard 6 | 15.4h | 46,077 | 4h / 2,550 | 19.4h (0.8d) | 390 per unit |
| Log Ram | wrightyard 1, barracks 5, hall 5, drillyard 2 | 4.3h | 12,175 | 2h / 800 | 6.3h (0.3d) | 210 per unit |
| Firecart | wrightyard 4, barracks 5, hall 5, drillyard 3 | 7h | 19,145 | 3h / 1,300 | 10h (0.4d) | 368 per unit |

## G. Travel time (hours, one way, flat ground, speed 1)

| unit | speed | 10 | 20 | 40 |
| --- | --- | --- | --- | --- |
| Raider | 6 | 1.67 | 3.33 | 6.67 |
| Elk Rider | 13 | 0.77 | 1.54 | 3.08 |
| Ember Guard | 9 | 1.11 | 2.22 | 4.44 |
| Hearthwarden | 11 | 0.91 | 1.82 | 3.64 |
| Log Ram | 3 | 3.33 | 6.67 | 13.33 |


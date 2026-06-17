# 🌋 Volcano Cats — Backend

Game server untuk Volcano Cats, multiplayer card game berbasis Exploding Kittens.

## Tech Stack
- **Runtime**: Node.js + TypeScript
- **Game Server**: Colyseus 0.15
- **Deploy**: Railway

## Setup Local

```bash
# Install dependencies
npm install

# Copy env
cp .env.example .env
# Edit .env sesuai kebutuhan

# Dev mode (hot reload)
npm run dev

# Build + start production
npm run build && npm start
```

Server berjalan di `http://localhost:3001`
Colyseus monitor: `http://localhost:3001/colyseus`

## Deploy ke Railway

1. Push repo ke GitHub
2. Buat project baru di [Railway](https://railway.app)
3. Connect repo GitHub
4. Set environment variables:
   - `CLIENT_URL` = URL Vercel frontend kamu
   - `NODE_ENV` = `production`
5. Railway otomatis deploy dan set `PORT`

## Struktur Project

```
src/
├── index.ts              # Entry point, Express + Colyseus server
├── rooms/
│   └── VolcanoCatsRoom.ts  # Colyseus room, handle join/leave/message
├── game/
│   └── engine.ts         # Pure game logic (shuffle, draw, play card, dll)
└── types/
    ├── cards.ts          # Card definitions & types
    └── game.ts           # GameState, Player, Message types
```

## WebSocket Messages

### Client → Server
|           Type            |                   Payload                 |                   Keterangan                  |
|---------------------------|------------------------------|------------|-----------------------------------------------|
| `START_GAME`              | -                                         | Host mulai game                               |
| `DRAW_CARD`               | -                                         | Draw kartu dari deck                          |
| `PLAY_CARD`               | `{ cardId, targetId? }`                   | Main 1 kartu aksi                             |
| `PLAY_GANG`               | `{ cardIds[], targetId?, targetCardId? }` | Main 2-5 gang card                            |
| `USE_WATER_BUCKET`        | `{ insertPosition }`                      | Taruh Lava Cat di posisi X                    |
| `BRIBE_GIVE_CARD`         | `{ cardId }`                              | Kasih kartu saat kena Bribe                   |
| `PEEK_SWAP_DECISION`      | `{ swap, cardId? }`                       | Keputusan setelah Peek & Swap                 |
| `FLOOD_DISCARD`           | `{ cardId }`                              | Buang kartu saat Flood / ambil saat Time Warp |
| `FREEZE_PLAY`             | -                                         | Mainkan Freeze sebagai interrupt              |
| `GANG_RAINBOW_CONFIRM`    | `{ targetId }`                            | Konfirmasi target Rainbow Gang                |

### Server → Client
|         Type          |        Payload        |            Keterangan            |
|-----------------------|-----------------------|-----------------------------------|
| `GAME_STATE_UPDATE`   | `ClientGameState`     | Update state (broadcast ke semua) |
| `YOUR_HAND`           | `{ cards: Card[] }`   | Kartu di tangan kamu (private)    |
| `PEEK_RESULT`         | `{ cards: Card[] }`   | Hasil Spy Cat / Peek & Swap       |
| `ERROR`               | `{ message }`         | Error message                     |

## Game Rules Summary

- 2-10 pemain
- Setiap pemain dapat 6 kartu + 1 Water Bucket
- Draw kartu di akhir giliran
- Kena Lava Cat tanpa Water Bucket = MATI
- Pemain terakhir yang hidup = MENANG

### Kartu Spesial Baru
- **Reverse**: Balik arah giliran
- **Sniper**: Paksa pemain lain draw sekarang
- **Peek & Swap**: Lihat kartu atas deck, boleh swap
- **Bunker**: Shield sekali dari efek negatif
- **Pickpocket**: Steal kartu random dari target
- **Flood**: Semua buang 1 kartu
- **Time Warp**: Ambil kartu dari discard pile
- **Lockdown**: Target tidak bisa main kartu giliran berikutnya
- **Gang Cards**: 2=steal random, 3=steal pilihan, 4=steal semua, 5 rainbow=swap tangan

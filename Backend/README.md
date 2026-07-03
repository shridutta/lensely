# Lensly Backend — Excel as Database (MVP)

All data is stored in a single Excel file: `data/lensly.xlsx`

---

## Setup (first time)

```bash
# 1. Install dependencies (one time only)
npm install

# 2. Start the server
node server.js
```

Server starts on **http://localhost:3000**
Excel file is created automatically at `data/lensly.xlsx` on first run.

---

## File Structure

```
lensly-backend/
├── server.js          ← The API server
├── package.json
├── data/
│   └── lensly.xlsx    ← All data lives here (open in Excel anytime)
└── public/
    └── lensly-x-inbox.html  ← Updated inbox page (copy to your IIS folder)
```

---

## Excel Sheets

### Sheet 1 — Photographers
| Column | Description |
|--------|-------------|
| id | Unique ID (e.g. PHT-001) |
| name | Full name |
| specialty | What they shoot |
| service_type | Photographer / Cinematographer / etc. |
| city, state | Location |
| phone, email | Contact |
| half_day_rate | ₹ for 6 hrs |
| full_day_rate | ₹ for 12 hrs (should = 2× half) |
| ot_rate_per_hr | Overtime hourly rate |
| status | Active / Inactive |
| outstation | Yes / No |

### Sheet 2 — BookingRequests
| Column | Description |
|--------|-------------|
| id | Unique booking ID |
| booking_ref | Reference shown to clients (LNS-XXXXX) |
| client_name | Who is booking |
| photographer_id | Links to Photographers sheet |
| package | Half Day / Full Day |
| shoot_date | YYYY-MM-DD |
| status | **Pending / Accepted / Rejected / Completed** |
| responded_on | Timestamp when photographer accepted/rejected |

---

## API Endpoints

### Photographers
| Method | URL | What it does |
|--------|-----|-------------|
| GET | /api/photographers | List all photographers |
| GET | /api/photographers/:id | Get one |
| POST | /api/photographers | Add new photographer |
| PATCH | /api/photographers/:id | Update (status, rates, etc.) |
| DELETE | /api/photographers/:id | Remove |

**Filter examples:**
```
GET /api/photographers?status=Active
GET /api/photographers?service_type=Cinematographer
GET /api/photographers?city=Mumbai
```

### Booking Requests
| Method | URL | What it does |
|--------|-----|-------------|
| GET | /api/bookings | List all bookings |
| GET | /api/bookings?photographer_id=PHT-001 | Filter by photographer |
| GET | /api/bookings?status=Pending | Filter by status |
| POST | /api/bookings | Create new booking (from client app) |
| PATCH | /api/bookings/:id/accept | Photographer accepts → updates Excel |
| PATCH | /api/bookings/:id/reject | Photographer declines → updates Excel |
| PATCH | /api/bookings/:id/complete | Mark shoot as done |

### Dashboard
| Method | URL | What it does |
|--------|-----|-------------|
| GET | /api/summary | Counts + revenue summary |

---

## Testing the API (quick checks)

Open these in your browser to verify:

```
http://localhost:3000/api/photographers
http://localhost:3000/api/bookings
http://localhost:3000/api/summary
```

Or use Postman / curl:
```bash
# Accept a booking
curl -X PATCH http://localhost:3000/api/bookings/BKG-001/accept

# Reject a booking with a reason
curl -X PATCH http://localhost:3000/api/bookings/BKG-001/reject \
  -H "Content-Type: application/json" \
  -d '{"reason": "Already booked on this date"}'

# Add a new photographer
curl -X POST http://localhost:3000/api/photographers \
  -H "Content-Type: application/json" \
  -d '{"name":"Raj Sharma","service_type":"Drone Pilot","city":"Delhi","state":"Delhi","half_day_rate":12000,"full_day_rate":24000,"ot_rate_per_hr":2000}'
```

---

## Connecting the Frontend (IIS)

1. Copy `public/lensly-x-inbox.html` to your IIS `photobook/` folder
2. Keep the Node server running on port 3000 alongside IIS
3. The inbox page automatically calls `http://localhost:3000/api` to load and update bookings

> If your IIS and the Node server are on different machines,
> replace `localhost:3000` in the HTML with your server's IP address.

---

## Viewing/Editing data directly

Just open `data/lensly.xlsx` in Excel at any time.
You can edit values directly in Excel — they take effect the next time the server reads the file.

> Do not leave the file open in Excel while the server is writing to it —
> close and reopen to see fresh data.

// Load environment variables from .env
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3001;

// ========================
// FIREBASE INITIALIZATION
// ========================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // PRIVATE KEY me \n ko actual new lines me convert kar rahe hain
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const donorsRef = db.ref('donors');
const requestsRef = db.ref('requests');

// ========================
// MIDDLEWARE
// ========================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files (HTML, CSS, JS, images) serve from current folder
app.use(express.static(__dirname));

// ========================
// HELPER FUNCTIONS
// ========================
function toRad(value) {
  return (value * Math.PI) / 180;
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// ========================
// GET ROUTES (Pages)
// ========================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'request.html'));
});

// response.html static file ke through hi serve ho jayega
// iske liye alag route ki zarurat nahi, kyunki upar express.static laga hua hai

// ========================
// POST: /register (Donor registration)
// ========================
app.post('/register', async (req, res) => {
  try {
    console.log('Register route hit, body =', req.body);

    const {
      name,
      age,
      gender,
      bloodGroup,
      phone,
      city,
      latitude,
      longitude,
    } = req.body;

    if (!name || !bloodGroup || !phone) {
      return res.status(400).send('Missing required fields');
    }

    const donorData = {
      name,
      age,
      // gender,
      bloodGroup,
      contact: phone,
      city,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      createdAt: Date.now(),
    };

    // 1) Firebase me store
    await donorsRef.push(donorData);

    // 2) Local JSON file me bhi store (optional, for localhost check)
    const filePath = path.join(__dirname, 'donors.json');

    let existing = [];
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw) existing = JSON.parse(raw);
    }

    existing.push(donorData);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    console.log('Donor saved successfully');

    // Success page (tum apne project me jo file ka naam rakho, wahi rakho)
    res.redirect('/success_page.html');
  } catch (err) {
    console.error('Error saving donor:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ========================
// POST: /submit_request (Blood request)
// ========================
app.post('/submit_request', async (req, res) => {
  try {
    console.log('Request route hit, body =', req.body);

    const {
      name,
      bloodGroup,
      contact,
      city,
      hospital,
      latitude,
      longitude,
    } = req.body;

    if (!bloodGroup) {
      return res.status(400).send('Blood group is required');
    }

    const reqLat = latitude ? Number(latitude) : null;
    const reqLon = longitude ? Number(longitude) : null;

    // Request ko DB me save karna (tracking ke liye)
    await requestsRef.push({
      name,
      bloodGroup,
      contact,
      // city,
      hospital,
      latitude: reqLat,
      longitude: reqLon,
      createdAt: Date.now(),
    });

    // Same blood group ke donors Firebase se lao
    const snapshot = await donorsRef
      .orderByChild('bloodGroup')
      .equalTo(bloodGroup)
      .once('value');

    const donors = [];

    snapshot.forEach((child) => {
      const d = child.val();
      if (!d) return;

      let distance = null;
      if (
        reqLat != null &&
        reqLon != null &&
        d.latitude != null &&
        d.longitude != null
      ) {
        distance = getDistanceKm(
          reqLat,
          reqLon,
          Number(d.latitude),
          Number(d.longitude)
        );
      }

      donors.push({
        name: d.name,
        age: d.age,
        bloodGroup: d.bloodGroup,
        contact: d.contact,
        city: d.city,
        distance: distance ?? 99999,
      });
    });

    // Distance ke hisaab se sort karo (nearest first)
    donors.sort((a, b) => a.distance - b.distance);

    const topDonors = donors.slice(0, 20);

    // Donors list ko response.html ko bhejo (query param me)
    const donorsParam = encodeURIComponent(JSON.stringify(topDonors));

    res.redirect(`/response.html?donors=${donorsParam}`);
  } catch (err) {
    console.error('Error handling request:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ========================
// START SERVER
// ========================
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

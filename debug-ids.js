const fetch = require('node-fetch');

const checkIds = async () => {
    try {
        const response = await fetch('http://localhost:3001/api/bookings');
        const data = await response.json();
        const bookings = data.bookings || [];

        console.log('--- DB Content ---');
        bookings.forEach(b => {
            console.log(`Numeric ID: ${b.id}, String ID (booking_id): ${b.booking_id}`);
        });

        if (bookings.length > 0) {
            const sample = bookings[0];
            console.log(`\n--- Testing Fetch by ID ---`);
            // Test String ID
            const strResp = await fetch(`http://localhost:3001/api/bookings/${sample.booking_id}`);
            console.log(`Fetch '${sample.booking_id}': status ${strResp.status}`);

            // Test Numeric ID
            const numResp = await fetch(`http://localhost:3001/api/bookings/${sample.id}`);
            console.log(`Fetch '${sample.id}': status ${numResp.status}`);
        }
    } catch (e) {
        console.error(e);
    }
};

checkIds();

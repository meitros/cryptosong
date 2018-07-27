const dotenv = require('dotenv');

dotenv.config();

const app = require('./server/server-config');

const port = process.env.PORT || 3000;

app.listen(port);

console.log('Serving up fresh HTML on port', port);

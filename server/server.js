const app = require('./app');
const port = process.env.PORT || 3100;

app.listen(port, () => {
    console.log('opencanada-api listening on :' + port);
});

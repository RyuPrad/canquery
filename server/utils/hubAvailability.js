// Whether a dataset hub has data to show, as its read service last saw it. The hub's
// sitewide links (the section nav of every page the server renders, the footer) appear
// only while it has: a deployment that never runs the hub's owner job links to nothing.
const available = new Set();

function setHubAvailable(name, value) {
    if (value) available.add(name);
    else available.delete(name);
}
const hubAvailable = name => available.has(name);

module.exports = { setHubAvailable, hubAvailable };

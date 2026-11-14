// The engine adds figures up over the rows of a long table only when told to
// (CHART_AUTO_SUMS=all); by default it leaves those sums to the chart
// builder. The rules for adding up are tested with it told to.
function addUpLongTables() {
    let before;
    beforeAll(() => {
        before = process.env.CHART_AUTO_SUMS;
        process.env.CHART_AUTO_SUMS = 'all';
    });
    afterAll(() => {
        if (before === undefined) delete process.env.CHART_AUTO_SUMS;
        else process.env.CHART_AUTO_SUMS = before;
    });
}

module.exports = { addUpLongTables };

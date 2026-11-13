const { isMissingToken, isBlankLabel, isTotalLabel, isFootnoteLabel, isMarkedNote, isGenericName, cleanLabel, normalizeName,
    nameEvidence } = require('../services/charts/tokens');

describe('chart vocabulary', () => {
    test('missing-value tokens of number columns are matched whatever their case or padding', () => {
        for (const token of ['--', '-', '…', '..', 'n/a', 'N/A', ' NA ', 'x', 'X', 'F', 's.o.', 'null', '#N/A', 'No data', 'Sans objet', '*']) {
            expect(isMissingToken(token)).toBe(true);
        }
        for (const value of ['0', '12', 'Total', 'année', 'kcal', 'Ontario', '']) expect(isMissingToken(value)).toBe(false);
    });

    test('a category label is blank only when it cannot be a category', () => {
        for (const label of ['', '   ', '--', '+', '=', '…', 'n/a', 'NULL', '(blank)', null, undefined]) expect(isBlankLabel(label)).toBe(true);
        // In a text column these can be real members.
        for (const label of ['NA', 'X', 'SO', 'None', 'Unknown', 'Other', '0', 'F']) expect(isBlankLabel(label)).toBe(false);
    });

    test('totals are exact forms, never a name that merely starts like one', () => {
        for (const label of ['Total', 'TOTAL', 'Totals', 'Grand Total', 'Sub-total', 'Sous-total', 'Total général', 'Total:', 'Total *',
            'Total, all industries', 'Total - Age groups', 'Totaux']) {
            expect(isTotalLabel(label)).toBe(true);
        }
        // "All" or "Ensemble" can be a real member: such totals are found from the numbers.
        for (const label of ['Total capital', 'Total assets', 'All-terrain vehicles', 'Allowance', 'Canada', 'Both sexes', 'Totally other', '',
            'All', 'Tous', 'Toutes', 'Ensemble', 'Overall']) {
            expect(isTotalLabel(label)).toBe(false);
        }
    });

    test('notes and sources are recognised in both languages', () => {
        for (const label of ['Note: values are preliminary', 'Notes : voir le tableau', 'Source: Statistics Canada', 'Sources – ECCC',
            'Remarque : données révisées', 'For more information, see the report', 'Pour plus de renseignements, consultez', 'See note 2',
            'Voir la note 3', '© His Majesty the King', 'Footnotes']) {
            expect(isFootnoteLabel(label)).toBe(true);
        }
        for (const label of ['Nova Scotia', 'Notebook computers', 'Sourcing', '1. Agriculture', 'Northern region']) expect(isFootnoteLabel(label)).toBe(false);
    });

    test('numbered and starred openings are only marked, because numbered categories exist', () => {
        for (const label of ['1. Data are preliminary', '(2) Excludes Quebec', '* Estimate', '¹ Revised', '12) See above']) expect(isMarkedNote(label)).toBe(true);
        for (const label of ['Agriculture', '2021', '100 employees', '1.5 tonnes']) expect(isMarkedNote(label)).toBe(false);
    });

    test('labels are cleaned of control characters and runs of white space', () => {
        expect(cleanLabel('  High\tWage \n  stream ')).toBe('High Wage stream');
        expect(cleanLabel(null)).toBe('');
    });

    test('column names read alike across camel case, accents and separators', () => {
        expect(normalizeName('FiscalYear')).toBe('fiscal year');
        expect(normalizeName('Année_fiscale')).toBe('annee fiscale');
        expect(normalizeName('EN_PROVINCE/TERRITORY')).toBe('en province territory');
        expect(normalizeName("Nombre d'employés")).toBe('nombre d employes');
    });

    test('a name that says nothing is generic', () => {
        for (const name of ['column_3', 'Unnamed', 'value', 'Valeur', 'field 12', 'X', '2', '']) expect(isGenericName(name)).toBe(true);
        for (const name of ['Province', 'Total Gifts', 'Year', 'Montant']) expect(isGenericName(name)).toBe(false);
    });

    describe('name evidence', () => {
        test('reads quantities that add up and quantities that do not', () => {
            expect(nameEvidence('Approved Positions').additive).toBe(true);
            expect(nameEvidence('Montant total').additive).toBe(true);
            expect(nameEvidence('Unemployment rate').nonAdditive).toBe(true);
            expect(nameEvidence('Taux de chômage').nonAdditive).toBe(true);
            expect(nameEvidence('Median_Wage_Salaire_Median').nonAdditive).toBe(true);
            expect(nameEvidence('P_ÂGE').nonAdditive).toBe(true);
        });

        test('a name that reads both ways is not additive', () => {
            const name = nameEvidence('Average amount');
            expect(name.nonAdditive).toBe(true);
            expect(name.additive).toBe(false);
        });

        test('a count phrase is a quantity, not an identifier or a row number', () => {
            for (const label of ['Number of permits', 'No. of employees', 'Nbre de cas', "Nombre d'employés", '# of visits']) {
                const name = nameEvidence(label);
                expect(name.additive).toBe(true);
                expect(name.identifier).toBe(false);
                expect(name.rowNumber).toBe(false);
            }
            expect(nameEvidence('Corporation number').identifier).toBe(true);
            expect(nameEvidence('Numéro de société').identifier).toBe(true);
        });

        test('index is a row number only when it is the whole name', () => {
            expect(nameEvidence('index').rowNumber).toBe(true);
            expect(nameEvidence('#').rowNumber).toBe(true);
            expect(nameEvidence('Price index').rowNumber).toBe(false);
            expect(nameEvidence('Price index').nonAdditive).toBe(true);
        });

        test('reads periods, measure names, units, geometry and language markers', () => {
            expect(nameEvidence('Fiscal Year').period).toBe(true);
            expect(nameEvidence('Trimestre').yearPart).toBe(true);
            expect(nameEvidence('Data Point Address Label').measureName).toBe(true);
            expect(nameEvidence('Currency_Devise').unit).toBe(true);
            expect(nameEvidence('Shape__Area').geometry).toBe(true);
            expect(nameEvidence('description_e').english).toBe(true);
            expect(nameEvidence('NOC_Title_fra').french).toBe(true);
            expect(nameEvidence('2023 Total').total).toBe(true);
        });
    });
});

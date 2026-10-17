You want to know whether a Toronto shop, contractor or mobile vendor holds a city business licence, or you want to list every licensed business in a category. The City of Toronto's **Municipal Licensing and Standards – Business Licences and Permits** dataset is the official record for the licence and permit categories issued by Municipal Licensing & Standards (ML&S). It is a live table on CanQuery, so you can search it in your browser without downloading a 35 MB file.

The dataset covers business categories such as eating establishments, holistic centres, building renovators and mobile vendors. The City notes that it does not include licences for individual people, such as taxicab drivers or holistic practitioners.

## Open the business licences table

1. [Open the Toronto business licences table in CanQuery](/resources/ckan-toronto-open-data-resource-169e90ba-3ae0-43dd-8b2f-919e87002f50). The copy prepared on CanQuery holds about 160,000 records and is refreshed from the City's DataStore.
2. Type an operating name, a client name or a street in the search box above the table. The search covers the text of every column, so a street name can match the licence address as well as a business name that contains the same word.
3. Read **Category**, **Licence No.**, **Operating Name**, **Issued** and **Cancel Date** together. A record with a cancel date is no longer an active licence even though it stays in the table.
4. Use the **Ward** column to narrow a search to one part of the city, and **Conditions** or **Endorsements** to see restrictions the City attached to a licence.
5. Export the filtered rows as CSV when you need them in a spreadsheet. The export is limited to 10,000 rows, so filter by category or ward first for a complete extract.

For an exact match on a category, enter `=EATING ESTABLISHMENT` in the **Category** column filter. The leading `=` selects equality using the spelling recorded by the City; a plain word requests a contains filter instead. Column names and values are published in English only.

## Read a licence record carefully

The table lists licence and permit records, not a judgement about a business. A matching row shows that the City issued a licence of that category on the **Issued** date to the **Client Name** operating under the **Operating Name** at the recorded address. Check **Last Record Update** to see when the City last touched the record, and remember that the publisher's catalogue date describes the listing, not the day a business was inspected.

An empty search does not prove that a business is unlicensed. The business may operate under a different legal name, the licence may belong to a category this dataset does not include, or the spelling may differ from the City's record. Try the street address, a shorter name or the licence number printed on the business's certificate before drawing a conclusion.

## Follow the official source

The [City of Toronto's dataset page](https://open.toronto.ca/dataset/municipal-licensing-and-standards-business-licences-and-permits/) describes the categories, the refresh schedule and the readme file that accompanies the data. A separate dataset, [Business Licence Renewals and New Issues Summary](/datasets/toronto-open-data-municipal-licensing-and-standards-business-licence-renewals-and-new-issues-summary), counts renewals and new licences by period if you want totals rather than individual records.

Questions about a specific licence belong with Municipal Licensing & Standards. CanQuery gives you a searchable copy of the published records and a link back to the source.

## Continue exploring Toronto

The [Toronto place page](/places/toronto-on) lists the City's other open datasets, including [active building permits](/blog/toronto-building-permits). When you share a finding, include the [CanQuery dataset page](/datasets/toronto-open-data-municipal-licensing-and-standards-business-licences-and-permits), the official source and the date you consulted it.

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).

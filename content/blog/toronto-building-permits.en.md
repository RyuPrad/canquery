You have noticed work on a Toronto street and want to learn what the city's records say about it. The **Building Permits – Active Permits** dataset is a useful starting point. It contains active building applications and permits, with information collected from applications and updated during the city's review and inspection work.

CanQuery lets you search this official table in your browser. You can start with a street name, inspect matching records, and follow the source link when you need more context.

## Start with the active-permits table

1. [Open Toronto’s active building permits in CanQuery](/resources/ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05).
2. Use the search box above the table to enter a street name. This searches the table’s text, so a match can appear in a description as well as an address field.
3. Check the street and building-number fields in each result. A street can have several applications, and a single property can have more than one permit record.
4. Read the permit type, status, and work description together. Use the table’s horizontal scroll to see columns that do not fit on a smaller screen.
5. Copy the page URL to return to the same search. You can also use the CSV export to work with the results in a spreadsheet; the export is limited to 10,000 rows.

For a specific street, enter `=KING` in the **STREET_NAME** column filter for an exact match, using the spelling recorded by the publisher. The leading `=` selects equality; plain `KING` requests a contains filter and may require preparation. Equality filters work with both the live DataStore and a prepared copy. This selects the street field rather than matching the word “King” in a work description; check building numbers and street direction separately. Reading the live table in the browser does not require an account or a manual download.

For a repeatable extract, the [API reporting workflow](/docs#workflow) shows metadata inspection, `filters={"STREET_NAME":"KING"}`, a bounded row query and CSV export. It uses the same active-permits resource. Keep the query, source and retrieval date with your output.

## Choose active or cleared permits

- **Active applications and permits:** use the [active-permits dataset](/datasets/toronto-open-data-building-permits-active-permits) to explore work still recorded in the City's active process. Read each status; an application is not necessarily an issued permit.
- **Completed or closed records:** use the separate [cleared-permits dataset](/datasets/toronto-open-data-building-permits-cleared-permits). The [City's cleared-permits documentation](https://open.toronto.ca/dataset/building-permits-cleared-permits/) describes these as completed or closed records and warns that records with **APPLICATION_DATE** before October 1, 1999 may be incomplete because they came from legacy systems.

These are different record populations. Neither an empty active search nor the presence of a cleared record establishes a property's complete permit history. Inspect the fields and dates in the selected dataset before comparing results.

## What an active record means

The source includes **applications as well as permits**. Finding a record does not, by itself, establish that a permit has been issued or that construction has started. Look at the individual status and description instead of treating inclusion in this table as a single yes-or-no answer.

This is also an active-records dataset, not a complete history of every building project. An empty search does not prove that a property has never had a permit. Before drawing a conclusion, check your spelling, try a shorter street name, and review the publisher’s description of the dataset.

## Check dates and the official source

A catalogue metadata date describes a change to the dataset’s listing. It should not be read as the inspection date of a particular property. Likewise, the “Data links checked” date on this guide records our check of the links and workflow, not a fresh verification of every permit.

For the dataset’s collection method, available resources, and publisher information, open the [City of Toronto’s official active-permits page](https://open.toronto.ca/dataset/building-permits-active-permits/). Questions about a specific application belong with the City; CanQuery provides access to the published records.

## Continue exploring Toronto

Use the [Toronto place page](/places/toronto-on) to discover other local datasets. If you are sharing a finding, include the [CanQuery dataset page](/datasets/toronto-open-data-building-permits-active-permits), the official source, and the date you consulted it so another reader can check the same evidence.

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).

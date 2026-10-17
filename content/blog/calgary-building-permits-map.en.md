You want to see where building permits have been applied for or issued in Calgary, check the status of a permit on your street or compare permit activity between communities. The City of Calgary publishes **Building Permits**, a dataset of permit applications made to its Planning & Development department. On CanQuery you can explore it as an interactive map or open it as a table.

## Explore the permits on a map

1. [Open the Calgary building permits map in CanQuery](/resources/socrata-calgary-open-data-resource-c2es-76ed?view=map). Each point is a permit location; the City records the address, a community and a point geometry for every permit.
2. Zoom to your neighbourhood and select a point to read the permit record: **PermitNum**, **PermitType**, **PermitClass**, **WorkClass**, the **StatusCurrent** value and the applied, issued and completed dates.
3. Switch to the table view when you want to filter rather than browse. Enter a street name or a permit number in the search box, or filter the **StatusCurrent** column with `=Issued Permit` to keep issued permits only. The leading `=` selects an exact match using the City's spelling.
4. Export the filtered rows as CSV to work with them in a spreadsheet. The export is limited to 10,000 rows, so filter by community, year or permit type first.

The table is prepared the first time someone opens it, so the first visit can take a moment. Afterwards the copy stays available for filtering, charting and export.

## Read a permit record

The dataset lists **applications**, including permits that were later issued, cancelled or completed. **StatusCurrent** tells you where a record stands; **AppliedDate**, **IssuedDate** and **CompletedDate** show when each step happened. A record with an applied date and no issued date is an application, not an authorization to build.

**PermitClassGroup** and **WorkClassGroup** are the City's grouped categories, useful for counting residential or commercial activity; **PermitClass** and **WorkClass** hold the detailed values. **LocationCount** and **LocationAddresses** matter for permits that cover more than one address, such as a multi-building project. The City asks that general enquiries about property records go to its property research service; the open dataset is a published extract, not a title search.

## Check dates and the official source

The catalogue date on the dataset page describes when the City last changed the listing or the file. It is not the inspection date of any property. The [City of Calgary's dataset page](https://data.calgary.ca/d/c2es-76ed) describes the fields and links to the building permit process FAQ.

Related Calgary records on CanQuery include the [1:100 Flood Map](/blog/calgary-flood-map) and the [ward boundaries](/blog/calgary-ward-map), which help you read a permit's location against regulatory zones and wards.

## Continue exploring Calgary

The [Calgary place page](/places/calgary-ab) lists the City's other open datasets. When you share a finding, include the [CanQuery dataset page](/datasets/calgary-open-data-c2es-76ed), the official source and the date you consulted it.

Contains information licensed under the [Open Government Licence – City of Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).

## Open the boundary layer for Uxbridge

Durham Region publishes an open-data layer called **Uxbridge Ward Boundaries**. Use the [CanQuery dataset page](/datasets/arcgis-6881ab21ee78498e90d7317d20b3f8e9-32) to check the publisher and source links, then [open the interactive map](/resources/arcgis-6881ab21ee78498e90d7317d20b3f8e9-32-data?view=map). This is a polygon boundary layer: its main purpose is to show areas and their recorded attributes.

The resource can support both a map and a downloadable tabular representation. Those options serve different tasks. Start with the map when you want to see the areas; start with the original source when you need a file for your own analysis. You do not need to load a separate CSV table just to explore the available map.

## Read the map and its recorded fields

1. Open the map view and allow the layer to appear. Pan or zoom to inspect an area rather than assuming the first viewport represents a particular ward.
2. Select a visible feature to inspect its available attributes. Use **WARD** and **LABEL** as the recorded identifiers and labels, and check **MUNICIPALITY** for context.
3. Compare adjacent shapes visually, keeping the source’s boundary definitions in mind. A basemap label and a ward label describe different kinds of information.
4. Follow the publisher link when a missing attribute, an unexpected shape or a current-use question requires source documentation.

The recorded schema also includes **OBJECTID**, **Shape_Length** and **Shape_Area**. An object identifier is not necessarily a ward number. Do not interpret length or area values as metres, kilometres or another unit without checking the service’s coordinate system and documentation. CanQuery displays recorded fields rather than assigning new meanings to them.

## Choose a download that matches your task

The resource’s original download link requests a CSV from the publisher’s ArcGIS service. A CSV is useful for inspecting columns, but it should not be assumed to preserve the polygon geometry needed for GIS work. If you need the boundaries themselves in a GIS file, visit the [official Durham Region dataset page](https://opendata.durham.ca/datasets/DurhamRegion::uxbridge-ward-boundaries) and inspect the formats it currently offers.

For service details, the [published ArcGIS layer](https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/32) describes the fields and geometry. Keep the dataset title, source URL and download date with any extracted file. This makes it easier to distinguish a local copy from a later publisher update or from a similarly named dataset elsewhere.

## Check dates and intended use

A catalogue metadata date records a catalogue event; it does not establish the period during which a boundary is legally or administratively effective. The layer’s presence in CanQuery also does not confirm an address’s current electoral assignment. If your task requires current ward membership, check the responsible municipality’s current information and the publisher’s source documentation before relying on this layer.

The file’s recorded language is English. Switching CanQuery to French changes the interface and descriptive labels, while field names such as **WARD** and **LABEL** remain those of the source. This matters when matching a downloaded column to a field shown on the map.

## Continue from the source or the place page

Review Durham Region’s [Open Data Licence Agreement](https://www.durham.ca/en/regional-government/resources/Documents/OpenDataLicenceAgreement.pdf) before reusing the data. For additional local datasets, open the [Uxbridge place page](/places/uxbridge-on). Keep the distinction between a geographic catalogue match and the specific coverage described by each publisher: another dataset found for Uxbridge may cover a different area or subject.

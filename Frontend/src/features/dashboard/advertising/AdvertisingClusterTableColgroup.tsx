import type {
  AdvertisingColumnDefinition,
  AdvertisingColumnWidths,
} from "./clusterTableView";

export function AdvertisingClusterTableColgroup(props: {
  advertisingColumnWidths: AdvertisingColumnWidths;
  orderedAdvertisingColumns: AdvertisingColumnDefinition[];
  prefix: string;
}) {
  return (
    <colgroup>
      <col
        data-col-key="select"
        style={{
          width: `${String(props.advertisingColumnWidths.select)}px`,
          minWidth: `${String(props.advertisingColumnWidths.select)}px`,
        }}
      />
      {props.orderedAdvertisingColumns.map(({ key }) => (
        <col
          key={`${props.prefix}-${key}`}
          data-col-key={key}
          style={{
            width: `${String(props.advertisingColumnWidths[key])}px`,
            minWidth: `${String(props.advertisingColumnWidths[key])}px`,
          }}
        />
      ))}
    </colgroup>
  );
}

/** Missing/unverified cached samples are not evidence of an operational report. */
export function verifiedReportAnalytics(states: ReadonlyArray<{ data: unknown; isError?: boolean }>): boolean {
  return states.length === 3 && states.every(({ data, isError }) =>
    !isError && typeof data === "object" && data !== null &&
    "dataSource" in data && data.dataSource === "verified-tenant-data",
  );
}

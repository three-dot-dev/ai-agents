export function parseUsdtAmount(logData: string): string {
  const value = BigInt(logData);
  return (Number(value) / 1e6).toFixed(3); // keep 6 decimals
}

export function decodeTopicToAddress(topic: string): string {
  return '0x' + topic.slice(-40);
}

export function getTodayRangeUTC() {
  const now = new Date();
  const startUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const endUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return {
    start: startUTC.toISOString(),
    end: endUTC.toISOString(),
  };
}
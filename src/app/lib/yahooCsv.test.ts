import { describe, expect, it } from "vitest";
import { parseYahooCsv, watchlistNameFromFile } from "./yahooCsv";

const HEADER =
  "Symbol,Current Price,Date,Time,Change,Open,High,Low,Volume,Trade Date," +
  "Purchase Price,Quantity,Commission,High Limit,Low Limit,Comment,Transaction Type";

const row = (sym: string) => `${sym},234.89,2026/09/04,16:00 EDT,0.18,233.33,236.17,231.68,3055465,,,,,,,,`;

describe("parseYahooCsv", () => {
  it("reads the symbol column from a real Yahoo export", () => {
    const csv = [HEADER, row("IBM"), row("TEVA"), row("SOXX")].join("\n");
    expect(parseYahooCsv(csv).symbols).toEqual(["IBM", "TEVA", "SOXX"]);
  });

  it("keeps Yahoo's non-alphabetic ticker forms", () => {
    const csv = [HEADER, row("BRK-B"), row("^VIX"), row("ES=F"), row("BTC-USD")].join("\n");
    expect(parseYahooCsv(csv).symbols).toEqual(["BRK-B", "^VIX", "ES=F", "BTC-USD"]);
  });

  it("accepts a bare ticker list with no header", () => {
    expect(parseYahooCsv("aapl\nmsft\nnvda").symbols).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("does not mistake a headerless first row for a header", () => {
    expect(parseYahooCsv([row("AAPL"), row("MSFT")].join("\n")).symbols).toEqual(["AAPL", "MSFT"]);
  });

  it("dedupes and preserves first-seen order", () => {
    expect(parseYahooCsv("AAPL\nMSFT\naapl\nMSFT").symbols).toEqual(["AAPL", "MSFT"]);
  });

  it("skips blank lines and CRLF endings", () => {
    expect(parseYahooCsv(`${HEADER}\r\n${row("IBM")}\r\n\r\n${row("BB")}\r\n`).symbols)
      .toEqual(["IBM", "BB"]);
  });

  it("honours quoted fields so a comma in a comment cannot shift the column", () => {
    const csv = [HEADER, `AAPL,1,,,,,,,,,,,,,,"buy more, later",`].join("\n");
    expect(parseYahooCsv(csv).symbols).toEqual(["AAPL"]);
  });

  it("reports unusable tickers instead of importing them", () => {
    const { symbols, rejected } = parseYahooCsv("AAPL\nNOT A TICKER\nWAY-TOO-LONG-TO-BE-REAL\nMSFT");
    expect(symbols).toEqual(["AAPL", "MSFT"]);
    expect(rejected).toEqual(["NOT A TICKER", "WAY-TOO-LONG-TO-BE-REAL"]);
  });

  it("dedupes rejected entries", () => {
    expect(parseYahooCsv("bad ticker\nbad ticker").rejected).toEqual(["bad ticker"]);
  });

  it("returns empty for empty or whitespace input", () => {
    expect(parseYahooCsv("")).toEqual({ symbols: [], rejected: [] });
    expect(parseYahooCsv("  \n\n ")).toEqual({ symbols: [], rejected: [] });
  });

  it("returns empty for a header with no rows", () => {
    expect(parseYahooCsv(HEADER).symbols).toEqual([]);
  });
});

describe("watchlistNameFromFile", () => {
  it("titles the file stem", () => {
    expect(watchlistNameFromFile("portfolio.csv")).toBe("Portfolio");
    expect(watchlistNameFromFile("my_tech_list.csv")).toBe("My tech list");
  });

  it("falls back when there is no usable stem", () => {
    expect(watchlistNameFromFile(".csv")).toBe("Imported");
  });
});

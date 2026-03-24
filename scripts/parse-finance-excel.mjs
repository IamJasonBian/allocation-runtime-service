/**
 * Finance Excel Parser
 * Parses "Full Financial Planning.xlsx" into structured financial objects
 */
import XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';

const EXCEL_PATH = '/Users/jasonzb/Desktop/forecast.ui.com/Full Financial Planning .xlsx';

/**
 * Parse a fiscal year sheet into structured financial data
 */
function parseFiscalYearSheet(worksheet, fiscalYear) {
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  const assets = [];
  const liabilities = [];
  let monthHeaders = [];
  let currentSection = null;
  let currentCategory = null;

  jsonData.forEach((row, rowIndex) => {
    const firstCell = String(row[0] || '').trim();

    // Detect month headers (dates in first row)
    if (rowIndex <= 2 && row.some(cell => typeof cell === 'number' && cell > 44000 && cell < 50000)) {
      monthHeaders = row.slice(2).filter(cell => cell && typeof cell === 'number');
    }

    // Detect sections
    if (firstCell.toLowerCase() === 'assets') {
      currentSection = 'assets';
      currentCategory = null;
      return;
    }
    if (firstCell.toLowerCase() === 'liabilities') {
      currentSection = 'liabilities';
      currentCategory = null;
      return;
    }

    // Detect categories
    if (firstCell.toLowerCase() === 'liquid' || firstCell.toLowerCase() === 'non-liquid') {
      currentCategory = firstCell;
      return;
    }

    // Parse asset/liability line items
    if (currentSection && firstCell && !firstCell.toLowerCase().includes('total')) {
      const name = firstCell;
      const values = row.slice(2, 2 + monthHeaders.length).map(v =>
        typeof v === 'number' ? v : (v === '' ? 0 : parseFloat(v) || 0)
      );

      if (values.some(v => v !== 0)) {
        const item = {
          name,
          category: currentCategory || 'General',
          fiscalYear,
          values: monthHeaders.map((month, i) => ({
            month: excelDateToISO(month),
            value: values[i] || 0
          }))
        };

        if (currentSection === 'assets') {
          assets.push(item);
        } else {
          liabilities.push(item);
        }
      }
    }
  });

  return { assets, liabilities };
}

/**
 * Convert Excel date number to ISO date string
 */
function excelDateToISO(excelDate) {
  if (!excelDate || typeof excelDate !== 'number') return null;
  const epoch = new Date(1900, 0, 1);
  const days = excelDate - 2; // Excel has a leap year bug
  const date = new Date(epoch.getTime() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

/**
 * Main parser
 */
function parseFinanceExcel() {
  const file = readFileSync(EXCEL_PATH);
  const workbook = XLSX.read(file, { type: 'buffer' });

  const financialData = {
    metadata: {
      source: 'Full Financial Planning.xlsx',
      parsedAt: new Date().toISOString(),
      fiscalYears: []
    },
    fiscalYears: {}
  };

  // Parse relevant fiscal year sheets
  const fySheets = ['FY23-Nov', 'FY24-May', 'FY24-Nov (pre-vest-sizing)', 'FY25-May', 'FY25-Nov'];

  fySheets.forEach(sheetName => {
    if (workbook.SheetNames.includes(sheetName)) {
      console.log(`Parsing ${sheetName}...`);
      const worksheet = workbook.Sheets[sheetName];
      const data = parseFiscalYearSheet(worksheet, sheetName);

      financialData.fiscalYears[sheetName] = data;
      financialData.metadata.fiscalYears.push(sheetName);
    }
  });

  return financialData;
}

// Execute parser
try {
  console.log('Parsing financial Excel file...\n');
  const data = parseFinanceExcel();

  // Output to JSON file
  const outputPath = './public/finance-data.json';
  writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log('\n✓ Parsing complete!');
  console.log(`✓ Output: ${outputPath}`);
  console.log(`✓ Fiscal Years: ${data.metadata.fiscalYears.join(', ')}`);

  // Show summary
  Object.entries(data.fiscalYears).forEach(([fy, fyData]) => {
    console.log(`\n${fy}:`);
    console.log(`  Assets: ${fyData.assets.length} items`);
    console.log(`  Liabilities: ${fyData.liabilities.length} items`);
  });

} catch (error) {
  console.error('Error parsing Excel:', error.message);
  process.exit(1);
}

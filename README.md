# Miaoshou SHEIN Collect Box Automation

DOM/browser automation scripts for editing products in Miaoshou ERP SHEIN collect box.

## Files

- `run-20-continuous.mjs` - main automation script.
- `package.json` / `package-lock.json` - Node dependencies.

## Usage

Install dependencies:

```powershell
npm install
```

Run a batch:

```powershell
$env:MIAOSHOU_LIMIT='10'
$env:MIAOSHOU_START_ORDER='1'
node run-20-continuous.mjs
```

By default, the browser is kept open after completion or pause for review. Set `MIAOSHOU_KEEP_OPEN=0` to close automatically.

## Notes

This repository intentionally excludes browser profiles, screenshots, logs, local spreadsheets, and product data.

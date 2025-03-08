# Nightly Scripts

This directory contains scripts that are meant to be run on a nightly basis to perform maintenance tasks on the database.

## Available Scripts

### Energy Restoration (`restoreEnergy.js`)

This script restores users' energy by setting their `currentEnergy` to match their maximum `energy` value when it's below the maximum. This ensures players start each day with their full energy.

The script:
- Finds all users where `currentEnergy` is less than `energy`
- Updates their `currentEnergy` to match their `energy` value
- Logs the results to `logs/energy-restore.log`

## Running the Scripts

### Manual Execution

You can run individual scripts directly:

```bash
node scripts/nightly/restoreEnergy.js
```

### Running All Nightly Tasks

To run all nightly tasks at once, use the provided shell script:

```bash
./scripts/nightly/run-nightly-tasks.sh
```

## Setting Up Automated Execution

To run these scripts automatically every night, you can set up a cron job:

```bash
# Edit the crontab
crontab -e

# Add a line to run the script at midnight every day
0 0 * * * /path/to/your/project/scripts/nightly/run-nightly-tasks.sh >> /path/to/your/project/logs/nightly-cron.log 2>&1
```

## Logs

All scripts log their output to the `logs` directory:
- `logs/energy-restore.log` - Logs for the energy restoration script
- `logs/error.log` - Error logs for all scripts 
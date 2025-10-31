# Thru CLI

A command-line interface for interacting with the Thru blockchain network. The Thru CLI provides access to RPC methods and program upload functionality, making it easy to query blockchain data and deploy programs.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [Usage Examples](#usage-examples)
- [Output Formats](#output-formats)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/thru-network/thru-rpc.git
cd thru-rpc

# Build the CLI
cargo build --release --bin thru-cli

# The binary will be available at target/release/thru-cli
# Optionally, install it to your PATH
cargo install --path thru-cli
```

### Prerequisites

- Rust 1.70 or later
- Access to a Thru node RPC endpoint

## Quick Start

1. **First Run**: On first execution, the CLI will create a default configuration file:

```bash
thru-cli getversion
```

This creates `~/.thru/cli/config.yaml` with default settings.

2. **Configure Your Setup**: Edit the configuration file to set your RPC endpoint and private key:

```bash
# Edit the config file
nano ~/.thru/cli/config.yaml
```

3. **Test Connection**: Verify your setup by checking node health:

```bash
thru-cli gethealth
```

## Configuration

The CLI uses a YAML configuration file located at `~/.thru/cli/config.yaml`. This file is automatically created with default values on first run.

### Configuration File Structure

```yaml
# Thru CLI Configuration File
# This file contains settings for the Thru command-line interface

# RPC endpoint URL for connecting to the Thru node
rpc_base_url: "http://localhost:8080"

# Default private key (64-character hex string)
# WARNING: Keep this file secure and never share your private key
default_private_key: "0000000000000000000000000000000000000000000000000000000000000000"

# Public key of the uploader program
uploader_program_public_key: "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB"

# Request timeout in seconds
timeout_seconds: 30

# Maximum number of retries for failed requests
max_retries: 3

# Optional authorization token for HTTP requests (sent as Bearer token)
# auth_token: "your-bearer-token-here"
```

### Configuration Parameters

| Parameter | Description | Default | Required |
|-----------|-------------|---------|----------|
| `rpc_base_url` | Base URL for RPC requests | `http://localhost:8080` | Yes |
| `default_private_key` | Your private key (64-char hex) | All zeros (placeholder) | Yes |
| `uploader_program_public_key` | Uploader program public key | Default uploader | Yes |
| `timeout_seconds` | Request timeout | 30 | No |
| `max_retries` | Max retry attempts | 3 | No |
| `auth_token` | Authorization token for HTTP requests | None | No |

### RPC URL and Port Handling

The CLI uses standard port handling:

- **HTTP URLs without explicit port**: Default to port `80` (e.g., `http://localhost` → `http://localhost:80`)
- **HTTPS URLs without explicit port**: Default to port `443` (e.g., `https://grpc.alphanet.thruput.org` → `https://grpc.alphanet.thruput.org:443`)
- **Explicit ports**: Used exactly as specified (e.g., `http://localhost:8472` uses port `8472`)

**Examples:**

```yaml
# HTTPS with standard port (recommended for production)
rpc_base_url: "https://grpc.alphanet.thruput.org:443"

# HTTPS without explicit port (defaults to 443)
rpc_base_url: "https://grpc.alphanet.thruput.org"

# HTTP with custom port (common for local development)
rpc_base_url: "http://localhost:8472"

# HTTP without explicit port (defaults to 80)
rpc_base_url: "http://localhost"
```

**Important**: Do not use angle brackets `<>` around URLs in the config file.

### Authentication

If your Thru node requires authentication, you can configure an authorization token in your `config.yaml`:

```yaml
# Authentication example
rpc_base_url: "https://private.thru.io"
auth_token: "your-bearer-token-here"
```

The auth token will be sent as a Bearer token in the Authorization header for all HTTP requests and WebSocket connections to the RPC server.

### Setting Up Your Private Key

⚠️ **Security Warning**: Never share your private key or commit it to version control.

1. Generate a new private key (64 hex characters):
```bash
# Example: Generate a random private key
openssl rand -hex 32
```

2. Update your config file with the generated key:
```yaml
default_private_key: "your_64_character_hex_private_key_here"
```

## Commands

The CLI supports the following commands:

### RPC Commands

#### `getversion`
Get version information from the Thru node.

```bash
thru-cli [--json] getversion
```

#### `gethealth`
Get health status of the Thru node.

```bash
thru-cli [--json] gethealth
```

#### `getaccountinfo`
Get detailed account information for a specific account.

```bash
thru-cli [--json] getaccountinfo <account_public_key>
```

#### `getbalance`
Get balance for a specific account.

```bash
thru-cli [--json] getbalance <account_public_key>
```

#### `transfer`
Transfer tokens between accounts.

```bash
thru-cli [--json] transfer <src> <dst> <value>
```

**Parameters:**
- `<src>`: Source key name from configuration
- `<dst>`: Destination (key name from config or public address in taXX format)
- `<value>`: Amount to transfer (must be greater than 0)

### Program Commands

#### `program upload`
Upload a program to the blockchain.

```bash
thru-cli [--json] program upload [--uploader <pubkey>] <seed> <program_file>
```

**Parameters:**
- `--uploader <pubkey>`: Optional custom uploader program public key
- `<seed>`: Seed string for account derivation
- `<program_file>`: Path to the program binary file

#### `program cleanup`
Clean up program accounts associated with a seed.

```bash
thru-cli [--json] program cleanup [--uploader <pubkey>] <seed>
```

**Parameters:**
- `--uploader <pubkey>`: Optional custom uploader program public key
- `<seed>`: Seed string for account derivation

### Token Commands

#### `token`
Manage token programs and operations.

```bash
thru-cli [--json] token <subcommand> [options]
```

### Global Options

- `--json`: Output results in JSON format instead of human-readable format

## Usage Examples

### Basic RPC Operations

#### Check Node Version
```bash
# Human-readable output
$ thru-cli getversion
Version Information
  Thru Node: 1.0.0
  Thru RPC: 1.0.0

# JSON output
$ thru-cli --json getversion
{
  "version": {
    "thru-node": "1.0.0",
    "thru-rpc": "1.0.0"
  }
}
```

#### Check Node Health
```bash
# Healthy node
$ thru-cli gethealth
Node is healthy

# Unhealthy node
$ thru-cli gethealth
Node is unhealthy
  Reason: Node is behind
  Slots Behind: 150

# JSON output
$ thru-cli --json gethealth
{
  "health": "ok"
}
```

#### Get Account Information
```bash
# Human-readable output
$ thru-cli getaccountinfo taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
Account Information
  Public Key: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
  Balance: 1000000
  Owner: 11111111111111111111111111111111
  Data Size: 0
  Nonce: 0
  State Counter: 0
  Is Program: No

# JSON output
$ thru-cli --json getaccountinfo taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
{
  "account_info": {
    "pubkey": "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB",
    "balance": 1000000,
    "owner": "11111111111111111111111111111111",
    "dataSize": 0,
    "nonce": 0,
    "stateCounter": 0,
    "program": false
  }
}
```

#### Get Account Balance
```bash
# Human-readable output
$ thru-cli getbalance taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
Account: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
Balance: 1000000

# JSON output
$ thru-cli --json getbalance taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB
{
  "balance": {
    "pubkey": "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEB",
    "balance": 1000000
  }
}
```

#### Transfer Tokens
```bash
# Transfer using key names
$ thru-cli transfer alice bob 1000
Transfer Information
  Source: alice
  Destination: bob
  Value: 1000
  Signature: ts1234567890abcdef...
  Status: success
Success: Transfer completed successfully. Transaction signature: ts1234567890abcdef...

# Transfer to public address
$ thru-cli transfer alice taXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX 1000
Transfer Information
  Source: alice
  Destination: taXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  Value: 1000
  Signature: ts1234567890abcdef...
  Status: success
Success: Transfer completed successfully. Transaction signature: ts1234567890abcdef...

# JSON output
$ thru-cli --json transfer alice bob 1000
{
  "transfer": {
    "src": "alice",
    "dst": "bob",
    "value": 1000,
    "signature": "ts1234567890abcdef...",
    "status": "success"
  }
}
```

### Program Operations

#### Upload a Program
```bash
# Upload example event emission program
$ thru-cli program create --ephemeral event tn_event_emission_program.bin
Info: Creating ephemeral managed program from file: tn_event_emission_program.bin (11429 bytes)
Info: User seed: event
...
Success: ✓ Temporary buffer account cleaned up successfully
Success: 🎉 Ephemeral managed program created successfully!
Info: Meta account: tawj43TAX-gGvprgAofnqt_FJ2Zw8vP86n-WhGFyL4qjis
Info: Program account: taWFVEPJNOTo-VTmKizwNtGi4vPaZNyhjjJZahcwFbGkwO

# Now execute transaction against just uploaded program
$ thru-cli txn execute taWFVEPJNOTo-VTmKizwNtGi4vPaZNyhjjJZahcwFbGkwO 03000000000000000100000000000000546f2062652c206f72206e6f7420746f2062653f2020202020202020202020202020202020202020202020202020202020202020202020202020202020202020
Success: Transaction executed successfully
Signature: tskn_ZeBCq7VEx6vbxGphLfp0DOZp5VTCHa-wXXRJU1jcZmsoJOPOKG54aGkI_wcRbcP8MB8RXnGsqXNdnjFM4BRwa
Slot: 33
Compute Units Consumed: 16343
State Units Consumed: 0
Execution Result: 0
VM Error: 0
User Error Code: 3
Events Count: 3
Events Size: 246
Pages Used: 2

Events:
  Event 1: call_idx=0, program_idx=1
    Event type: 1
    Data (string): "To be, or not to be?                                            "
  Event 2: call_idx=0, program_idx=1
    Event type: 1
    Data (string): "To be, or not to be?                                            "
  Event 3: call_idx=0, program_idx=1
    Event type: 1
    Data (string): "To be, or not to be?                                            "

# Upload with default uploader
$ thru-cli program upload my_program_seed ./my_program.bin
Info: Reading program file: ./my_program.bin (1024 bytes)
Info: Program hash: a1b2c3d4e5f6789...
Info: Meta account: xyz123...
Info: Buffer account: abc456...
Info: Upload will require 3 transactions (1 chunks of 1024 bytes each)
Program Upload
  Status: success
  Total Transactions: 3
  Completed: 3
  Program Size: 1024 bytes
  Meta Account: xyz123...
  Buffer Account: abc456...
Success: Program upload completed successfully

# Upload with custom uploader
$ thru-cli program upload --uploader custom_uploader_pubkey my_program_seed ./my_program.bin

# JSON output
$ thru-cli --json program upload my_program_seed ./my_program.bin
{
  "program_upload": {
    "status": "success",
    "total_transactions": 3,
    "completed_transactions": 3,
    "program_size": 1024,
    "meta_account": "xyz123...",
    "buffer_account": "abc456..."
  }
}
```

#### Clean Up Program Accounts
```bash
# Cleanup with default uploader
$ thru-cli program cleanup my_program_seed
Info: Cleaning up accounts for seed: my_program_seed
Info: Meta account: xyz123...
Info: Buffer account: abc456...
Program Cleanup
  Status: success
  Message: Program accounts cleaned up successfully
Success: Program cleanup completed successfully

# JSON output
$ thru-cli --json program cleanup my_program_seed
{
  "program_cleanup": {
    "status": "success",
    "message": "Program accounts cleaned up successfully"
  }
}
```

## Output Formats

The CLI supports two output formats:

### Human-Readable Format (Default)
- Colored output with clear labels
- Status indicators (green for success, red for errors)
- Formatted information with proper indentation
- Progress information for long operations

### JSON Format (`--json` flag)
- Machine-readable structured output
- Consistent schema across all commands
- Suitable for scripting and automation
- Error information included in JSON structure

### Error Handling

Both output formats handle errors gracefully:

```bash
# Human-readable error
$ thru-cli getaccountinfo invalid_key
Error: Validation error: Invalid public key: invalid_key

# JSON error
$ thru-cli --json getaccountinfo invalid_key
{
  "error": "Validation error: Invalid public key: invalid_key"
}
```


## Troubleshooting

### Common Issues

#### 1. Configuration File Not Found
**Problem**: CLI reports config file not found.
**Solution**: Run any command to auto-generate the default config:
```bash
thru-cli getversion
```

#### 2. Connection Refused
**Problem**: `Failed to get version: Connection refused`
**Solution**: 
- Check if your Thru node is running
- Verify the `rpc_base_url` in your config file
- Ensure the RPC port is accessible

#### 3. Invalid Private Key
**Problem**: `Configuration error: Invalid private key`
**Solution**: 
- Ensure your private key is exactly 64 hexadecimal characters
- Generate a new key: `openssl rand -hex 32`
- Update your config file with the new key

#### 4. Account Not Found
**Problem**: `Account not found for address: ...`
**Solution**: 
- Verify the account public key is correct
- Check if the account exists on the network
- Ensure you're connected to the correct network

#### 5. Program File Not Found
**Problem**: `Program file not found: ./program.bin`
**Solution**: 
- Check the file path is correct
- Ensure the file exists and is readable
- Use absolute path if relative path fails

#### 6. Timeout Errors
**Problem**: Request timeouts during operations
**Solution**: 
- Increase `timeout_seconds` in config
- Check network connectivity
- Verify node is responsive

### Debug Information

For debugging connection issues:

```bash
# Test basic connectivity
curl http://localhost:8080/api/getversion

# Check config file location
ls -la ~/.thru/cli/config.yaml

# Validate config syntax
cat ~/.thru/cli/config.yaml
```

### Getting Help

```bash
# Show help for main command
thru-cli --help

# Show help for program subcommands
thru-cli uploader --help

# Show help for specific subcommand
thru-cli uploader upload --help
```




thru-cli program --help

# Show help for specific subcommand
thru-cli program upload --help
```

## Security Considerations

### Private Key Security

1. **File Permissions**: Ensure your config file has restricted permissions:
```bash
chmod 600 ~/.thru/cli/config.yaml
```

2. **Environment Variables**: Consider using environment variables for sensitive data:
```bash
export THRU_PRIVATE_KEY="your_private_key_here"
```

3. **Version Control**: Never commit your config file with real private keys:
```bash
# Add to .gitignore
echo "~/.thru/cli/config.yaml" >> .gitignore
```

### Network Security

1. **HTTPS**: Use HTTPS endpoints for production:
```yaml
rpc_base_url: "https://your-node.example.com"
```

2. **Firewall**: Ensure your RPC endpoint is properly secured
3. **Authentication**: Use proper authentication if required by your node

### Best Practices

1. **Separate Keys**: Use different private keys for different environments
2. **Regular Rotation**: Rotate private keys periodically
3. **Backup**: Securely backup your private keys
4. **Monitoring**: Monitor account activity for unauthorized transactions

### Program Upload Security

1. **Code Review**: Always review program code before upload
2. **Testing**: Test programs thoroughly on testnet first
3. **Verification**: Verify program hashes match expected values
4. **Access Control**: Use appropriate uploader program permissions

## Advanced Usage

### Scripting with JSON Output

The JSON output format makes the CLI suitable for scripting:

```bash
#!/bin/bash

# Check if node is healthy
HEALTH=$(thru-cli --json gethealth | jq -r '.health')
if [ "$HEALTH" != "ok" ]; then
    echo "Node is unhealthy: $HEALTH"
    exit 1
fi

# Get account balance
BALANCE=$(thru-cli --json getbalance $ACCOUNT_KEY | jq -r '.balance.balance')
echo "Account balance: $BALANCE"
```

### Batch Operations

```bash
# Check multiple account balances
for account in account1 account2 account3; do
    echo "Checking balance for $account"
    thru-cli --json getbalance $account
done
```

### Configuration Management

```bash
# Backup current config
cp ~/.thru/cli/config.yaml ~/.thru/cli/config.yaml.backup

# Use different config for different networks
export THRU_CONFIG_PATH=~/.thru/cli/testnet-config.yaml
```

## Contributing

Contributions are welcome! Please see the main repository for contribution guidelines.

## License

This project is licensed under MIT OR Apache-2.0.

# Security Notes

## Known Issues

### Development Dependencies Vulnerabilities (Low Risk)

The following vulnerabilities exist in development dependencies and **do not affect the production application**:

- **nth-check <2.0.1**: Inefficient Regular Expression Complexity in nth-check (High severity)
- **postcss <8.4.31**: PostCSS line return parsing error (Moderate severity)  
- **webpack-dev-server <=5.2.0**: Source code exposure vulnerabilities (Moderate severity)

**Impact**: These vulnerabilities only affect the development build process and dev server, not the packaged production application.

**Mitigation**: 
- Only run development servers in trusted environments
- Do not expose development servers to public networks
- These will be resolved when react-scripts releases updates to dependencies

### API Key Security

- OpenAI API keys are stored in configuration files
- **Recommendation**: Use environment variables instead of config files
- Ensure config directory permissions are restricted: `chmod 600 ~/.whispertranscript/config.json`

### Process Security

- Python service runs with user privileges
- Local HTTP server binds to localhost only (port 8765)
- **Recommendation**: Firewall should block external access to port 8765

## Reporting Security Issues

If you discover a security vulnerability, please report it by creating an issue in the GitHub repository with the "security" label.
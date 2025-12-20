# Quadlet Systemd Files

These quadlet files configure systemd to manage the yapbay-api container using podman.

## Installation

Copy these files to `~/.config/containers/systemd/`:

```bash
cp systemd/yapbay-api.* ~/.config/containers/systemd/
```

Then reload systemd and start the service:

```bash
systemctl --user daemon-reload
systemctl --user start yapbay-api.service
```

## Files

- `yapbay-api.pod` - Defines the pod with host networking (to access postgres on 127.0.0.1:5432)
- `yapbay-api.container` - Defines the container configuration

## Configuration

Before starting, ensure:

1. The image is built: `npm run build-image`
2. `.env.production` exists with `POSTGRES_URL` set to `postgres://user:password@127.0.0.1:5432/yapbay`
3. Update the Volume path in `yapbay-api.container` to match your repository location

## Management

- Check status: `systemctl --user status yapbay-api.service`
- View logs: `journalctl --user -u yapbay-api.service -f`
- Restart: `systemctl --user restart yapbay-api.service`
- Stop: `systemctl --user stop yapbay-api.service`


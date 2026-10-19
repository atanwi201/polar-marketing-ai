# Firewall (ufw)

Only SSH, HTTP and HTTPS should be reachable. The Node app listens on 127.0.0.1 (`HOST=127.0.0.1` in the unit), so port 8787 is not exposed.

```
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp        # rate-limited SSH (or restrict to your IP: ufw allow from <ip> to any port 22)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Check from outside: `nmap -Pn <server>` should show only 22, 80, 443. Also set in `/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`.

#!/usr/bin/env zsh

# https://stackoverflow.com/questions/11542846/nvm-node-js-recommended-install-for-all-users
echo "=================================N=O=D=E========================================"

cd /usr/local/bin || exit 90

git clone https://github.com/nvm-sh/nvm.git .nvm

\. "/usr/local/bin/.nvm/nvm.sh"

nvm install --lts

node -e "console.log('Running Node.js ' + process.version)"

cat << "EOF" > /etc/profile.d/npm.sh
#!/usr/bin/env bash
export NVM_DIR="/usr/local/bin/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm'}

EOF

chmod 755 /etc/profile.d/npm.sh

npm install -g npm
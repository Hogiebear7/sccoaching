#!/bin/sh
# Regenerates the TEST-ONLY certificate chains used by the App Store tests. NOTHING here is Apple's: the "root" is a throwaway
# self-signed certificate created below, the keys are throwaway, and the chains carry the same marker extensions Apple's
# certificates carry so lib/providers/app-store-jws.ts can be exercised exactly as it runs in production.
#
# Run from this directory:  sh gen.sh
# Requires openssl. Validity is 100 years so the fixtures never expire under test.
set -e
cd "$(dirname "$0")"

make_chain() {
  prefix="$1"        # file name prefix
  leaf_marker="$2"   # "yes" or "no": whether the leaf carries Apple's marker OID

  openssl ecparam -name secp384r1 -genkey -noout -out "$prefix-root.key"
  openssl req -x509 -new -key "$prefix-root.key" -sha384 -days 36500 -subj "/CN=Test Root $prefix (NOT APPLE)" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$prefix-root.crt"

  openssl ecparam -name secp384r1 -genkey -noout -out "$prefix-int.key"
  openssl req -new -key "$prefix-int.key" -subj "/CN=Test Intermediate $prefix (NOT APPLE)" -out "$prefix-int.csr"
  printf "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n" > "$prefix-int.ext"
  openssl x509 -req -in "$prefix-int.csr" -CA "$prefix-root.crt" -CAkey "$prefix-root.key" -CAcreateserial -sha384 -days 36500 \
    -extfile "$prefix-int.ext" -out "$prefix-int.crt"

  openssl ecparam -name prime256v1 -genkey -noout -out "$prefix-leaf.ec.key"
  openssl pkcs8 -topk8 -nocrypt -in "$prefix-leaf.ec.key" -out "$prefix-leaf.key"
  openssl req -new -key "$prefix-leaf.key" -subj "/CN=Test Leaf $prefix (NOT APPLE)" -out "$prefix-leaf.csr"
  if [ "$leaf_marker" = "yes" ]; then
    printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n" > "$prefix-leaf.ext"
  else
    printf "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n" > "$prefix-leaf.ext"
  fi
  openssl x509 -req -in "$prefix-leaf.csr" -CA "$prefix-int.crt" -CAkey "$prefix-int.key" -CAcreateserial -sha256 -days 36500 \
    -extfile "$prefix-leaf.ext" -out "$prefix-leaf.crt"

  rm -f "$prefix-int.csr" "$prefix-int.ext" "$prefix-leaf.csr" "$prefix-leaf.ext" "$prefix-leaf.ec.key" "$prefix-root.srl" "$prefix-int.srl"
}

make_chain good yes
make_chain rogue yes      # a complete, self-consistent chain that does NOT lead to the pinned test root
make_chain nomarker no    # chains to its own root; leaf lacks Apple's marker OID
rm -f ./*.srl
echo "done"

#!/bin/bash

# Provide the full image path to generate the xray report.
# Example: ./generate-xray-report.sh git.grid:4567/usmc/tdol/core/container-images/tdol-nifi:6.2.3-101262

IMAGE_NAME=$1
json_file=${2:-detailed_report.json}

## Split up IMAGE_NAME
TAG="${IMAGE_NAME##*:}"
WITHOUT_TAG="${IMAGE_NAME%:*}"
REPOSITORY="${WITHOUT_TAG##*/}"

# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo "jq is required but it's not installed. Please install jq."
    exit 1
fi

if ! command -v jf &> /dev/null
then
    # Try common locations (Homebrew and system paths) in case PATH is limited
    if [ -x "/opt/homebrew/bin/jf" ]; then
        export PATH="/opt/homebrew/bin:$PATH"
    elif [ -x "/usr/local/bin/jf" ]; then
        export PATH="/usr/local/bin:$PATH"
    elif [ -x "/usr/bin/jf" ]; then
        export PATH="/usr/bin:$PATH"
    fi
fi

if ! command -v jf &> /dev/null
then
    echo "JFrog CLI is required but it's not installed or not on PATH."
    echo "Install it (brew install jfrog-cli) or ensure jf is in PATH."
    exit 1
fi


echo "Pulling image..."
docker pull --quiet $IMAGE_NAME

jf docker scan $IMAGE_NAME --format=simple-json > "$json_file"

echo "Removing image..."
docker image rm $IMAGE_NAME >/dev/null 2>&1

# Count the number of High or Medium severity vulnerabilities
critical_count=$(jq '[.vulnerabilities[] | select(.severity == "Critical") | .cves[].id] | unique | length' "$json_file")
high_count=$(jq '[.vulnerabilities[] | select(.severity == "High") | .cves[].id] | unique | length' "$json_file")
medium_count=$(jq '[.vulnerabilities[] | select(.severity == "Medium") | .cves[].id] | unique | length' "$json_file")
low_count=$(jq '[.vulnerabilities[] | select(.severity == "Low") | .cves[].id] | unique | length' "$json_file")
info_count=$(jq '[.vulnerabilities[] | select(.severity == "Info") | .cves[].id] | unique | length' "$json_file")
unknown_count=$(jq '[.vulnerabilities[] | select(.severity == "Unknown") | .cves[].id] | unique | length' "$json_file")

jq --arg critical "$critical_count" \
   --arg high "$high_count" \
   --arg medium "$medium_count" \
   --arg low "$low_count" \
   --arg info "$info_count" \
   --arg unknown "$unknown_count" \
   '. | .total_vulnerabilities = {"critical": ($critical | tonumber), "high": ($high | tonumber), "medium": ($medium | tonumber), "low": ($low | tonumber), "info": ($info | tonumber), "unknown": ($unknown | tonumber)}' "$json_file" \
    > temp.json && mv temp.json "$json_file"

jq --arg repository "$REPOSITORY" \
   --arg tag "$TAG" \
   '. | .image_details = {"repository": $repository, "tag": $tag }' "$json_file" \
    > temp.json && mv temp.json "$json_file"

# Output the result
echo ""
echo "Detailed json result created" $json_file
echo "Total Vulnerabilities by Severity:"
echo "Critical: $critical_count"
echo "High: $high_count"
echo "Medium: $medium_count"
echo "Low: $low_count"
echo "Info: $info_count"
echo "Unknown: $unknown_count"
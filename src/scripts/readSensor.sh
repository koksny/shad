sensor_name="Sensor"
mac_address_list=("00:00:00:00:00:00")
mqtt_server="localhost"
output_file="/path/to/sensor1.txt"

for count in ${!mac_address_list[@]}; do
    idx=$(expr "$count" + "1")
    mac_address=${mac_address_list[$count]}
    sensor_name_idx="$sensor_name$idx"

    bt=$(timeout 15 gatttool -b $mac_address --char-write-req --handle='0x0038' --value="0100" --lis>
    if [ -z "$bt" ]
    then
        echo "The reading failed"
    else
        # Fixed temperature reading
        temphexa=$(echo $bt | grep "value:" | head -n1 | awk -F': ' '{print $2}' | awk '{print $2$1}>
        # Original humidity reading method
        humhexa=$(echo $bt | awk -F ' ' '{print $13}'| tr [:lower:] [:upper:])

        temperature100=$(echo "ibase=16; $temphexa" | bc)
        humidity=$(echo "ibase=16; $humhexa" | bc)
        temperature=$(echo "scale=2;$temperature100/100"|bc)
        echo "T:${temperature}|M:${humidity}" > "$output_file"
    fi
done

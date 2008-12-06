# ~/.bash_profile
# 
# anything in this file is executed only at login, anything to happen in
# every shell should be placed in the bashrc file instead

source ~/etc/bash/run

#httpload() {
#    STAMP=`date +"%s"`;
#    echo "http://$1" > /tmp/$STAMP.http_load_temp_file
#    http_load -parallel $2 -seconds $3 /tmp/$STAMP.http_load_temp_file
#    rm -f /tmp/$STAMP.http_load_temp_file
#}

$(document).ready(function() {	
	$(".advanced").toggle();
	$("#optionDescriptions > * ").toggle();
	
    $("#advancedOptions").on("click", function(e) {
		$(".advanced").toggle(this.checked);
    });
	
    $(".optionRow").on("mouseover", function(e) {
		let optionName = $(e.currentTarget).children().first().attr('for');
        $("[data-option=" + optionName + "]").show();
    });
	
    $(".optionRow").on("mouseout", function(e) {
		let optionName = $(e.currentTarget).children().first().attr('for');
        $("[data-option=" + optionName + "]").hide();
    });
	
    $("#go").on("click", function(e) {
		$('#output').val('');
		let raw = $('#input').val();
		let bpm = parseFloat($('#bpm').val()) || 120;
		let diffName = $('#diffName').val() || "Converted";
		if ($('#advancedOptions').is(":checked")) {
			let framerate_ = parseFloat($('#framerate').val()) || 20;
			let renderDistance = parseFloat($('#renderDistance').val()) || 600;
			let renderLimit = parseInt($('#renderLimit').val()) || 4;
			let startTime = parseFloat($('#startTime').val()) || 0;
			let extraSpeeds = $('#extraSpeeds').is(":checked");
			$('#output').val(convert_negative_sv(raw, bpm, diffName, framerate_, renderDistance, renderLimit, startTime, extraSpeeds));		
		}
		else {
			$('#output').val(convert_negative_sv(raw, bpm, diffName));			
		}
    });
});

class Note {
	constructor(time, x, fake = false) {
        this.time = time;
        this.x = x;
        this.fake = fake;
        this.pos;
	}
}

class Speed {
	constructor(time, value) {
        this.time = time;
        this.value = value;
        this.pos;
	}
}

function dance(notes, speeds, framerate = 20, render_distance = 700, render_limit = 4) {
	let refresh_speed = 9999999999999;
	if (speeds.length == 0 || notes.length == 0) {
		console.log('error: missing speeds or notes');
		return;
	}
	
	// first, use the provided speeds to fill out the the absolute position of each note and speed
	let note_index = 0;
	
	// notes before the first speed (assuming it scrolls at a speed of 1)
	while (note_index < notes.length && notes[note_index].time < speeds[0].time) {
		notes[note_index].pos = notes[note_index].time;
		note_index ++;
	}

	// notes after the first speed and before the last speed
    let current_pos = speeds[0].time;
    let speed = speeds[0];

    for (let next_speed of speeds.slice(1)) {
        speed.pos = current_pos;

        while (note_index < notes.length && notes[note_index].time < next_speed.time) {
            notes[note_index].pos = current_pos + speed.value * (notes[note_index].time - speed.time);
            note_index ++;
		}
        
        current_pos += speed.value * (next_speed.time - speed.time);
        speed = next_speed;
	}
    
    // notes after the last speed
    speeds[speeds.length - 1].pos = current_pos;

    while (note_index < notes.length) {
        notes[note_index].pos = current_pos + speeds[speeds.length - 1].value * (notes[note_index].time - speeds[speeds.length - 1].time);
        note_index ++;
	}

	// now handle negative speeds by generating a new set of speeds and notes
    let output_speeds = [];
    let output_notes = [];
    speed = speeds[0];

    for (let next_speed of speeds.slice(1)) {  
        // positive speed - no issues      
        if (speed.value >= 0) {
            output_speeds.push(speed);
            speed = next_speed;
            continue;
		}
        
        // negative speed - need to output teleports and fake notes on every "frame" to simulate negative movement
        let frame_time = Math.round(speed.time); // effect needs to be locked to integer timestamps for it to work
        while (frame_time < next_speed.time) {
            let frame_pos = speed.pos + speed.value * (frame_time - speed.time);

            // get upcoming notes within the render distance
            let rendered_notes = notes.filter(
				note => note.pos >= frame_pos && note.pos <= (frame_pos + render_distance) && note.time >= frame_time
			);

            let unique_positions = [];
            // remove any notes past the render limit
            for (let i = 0; i < rendered_notes.length; i ++) {
                if (!unique_positions.includes(rendered_notes[i].pos)) {
					if (unique_positions.length < render_limit) {
                        unique_positions.push(rendered_notes[i].pos);
					}
                    else {
                        rendered_notes = rendered_notes.slice(0, i);
                        break;
					}
				}
			}
            
            // get the series of 1-ms teleport speeds that will place each note in the correct positions
            let teleport_speeds = [];
            let prev_pos = frame_pos;
            for (let note of rendered_notes) {
                // the teleport speed is equal to the distance between notes because teleport speed = distance / 1 ms
                teleport_speeds.push(note.pos - prev_pos);
                prev_pos = note.pos;
			}

            // generate the corresponding speeds (ignoring all 0-speed teleports) and fake notes
            let frame_output_speeds = [];
            let frame_output_notes = [];

            let current_time = frame_time
            for (let i = 0; i < teleport_speeds.length; i ++) {
				let teleport_speed = teleport_speeds[i];
				let note = rendered_notes[i];
                if (teleport_speed > 0) {
                    frame_output_speeds.push(new Speed(current_time, teleport_speed));
                    frame_output_notes.push(new Note(current_time + 1, note.x, true));
                    current_time ++;
				}
                else {
                    frame_output_notes.push(new Note(current_time, note.x, true));
				}
			}

            
            // add two more speeds, one to "refresh" the frame and one to freeze the notes for the duration of the next frame
            frame_output_speeds.push(new Speed(current_time, refresh_speed));
            frame_output_speeds.push(new Speed(current_time + 0.1, 0));

            // make sure you have enough time to execute the entire frame before adding it to the output
            if (frame_output_speeds[frame_output_speeds.length - 1].time < next_speed.time) {
                output_speeds = output_speeds.concat(frame_output_speeds);
                output_notes = output_notes.concat(frame_output_notes);
			}

            frame_time += Math.round(1000 / framerate); // again, effect needs to be locked to integer timestamps
		}

        speed = next_speed;
	}

    // now handle the last speed. we don't allow it to be negative, for simplicity
    if (speed.value < 0) {
        console.log('warning: last speed is negative. converting to 1x');
        output_speeds.push(new Speed(speed.time, 1));
	}
    else {
        output_speeds.push(speed);
	}

	// note that this contains all the required speeds and all the fake notes, but none of the original notes
    return [output_notes, output_speeds];
}

function parse_mania(raw, bpm, advanced = true) {
    let output_notes = [];
    let output_speeds = [];
	let line_match;
    for (let line of raw.split('\n')) {
		line = line.trim();

        // single notes
        line_match = (new RegExp(/^([\d\.]+),[\d\.]+,(\d+),\d+,\d+,\d+:\d+:\d+:\d+:$/)).exec(line);
        if (line_match) {
            output_notes.push(new Note(
				parseInt(line_match[2]), 
				parseInt(line_match[1])
			));
            continue;
		}

        // lns get turned into single notes
        line_match = (new RegExp(/^([\d\.]+),[\d\.]+,(\d+),\d+,\d+,\d+:\d+:\d+:\d+:\d+:$/)).exec(line);
        if (line_match) {
            output_notes.push(new Note(
				parseInt(line_match[2]), 
				parseInt(line_match[1])
			));
			continue;
		}
            
        // uninherited points
        line_match = (new RegExp(/^([\d\.]+),([\d\.]+),\d+,\d+,\d+,\d+,\d+,\d+$/)).exec(line);
        if (line_match) {
            output_speeds.push(new Speed(
				parseFloat(line_match[1]),
				60000 / parseFloat(line_match[2]) / bpm
			));
			continue;
		}
            
        // inherited points
        line_match = (new RegExp(/^([\d\.]+),-([\d\.]+),\d+,\d+,\d+,\d+,\d+,(\d+)$/)).exec(line);
        if (line_match) {
            let time = parseFloat(line_match[1]);
            let value = Math.round(100 / parseFloat(line_match[2]) * 100) / 100;

            if (advanced) {
                // a value between 9.01 and 9.99 indicates a speed between 1 and 99 (to get past osu's max speed of 10)
                if (value > 9 && value < 10)
                    value = (value - 9) * 100;

                // a value of 10.00 indicates a teleport
                else if (value == 10)
                    value = 9999999999999;
                    
                // a value of 0.01 (the minimum) indicates a stop
                else if (value == 0.01)
                    value = 0;
			}

            // kiai on an inherited point indicates it should be negative
            if (parseInt(line_match[3]) % 2 == 1)
                value = -value;

            output_speeds.push(new Speed(time, value));
		}
	}
    return [output_notes, output_speeds];
}

function format_mania(notes, speeds, bpm) {
    let meter = 999999;
    let zero = 9999999999999;
    let output_notes = [];
    for (let note of notes) {
        if (note.fake)
            output_notes.push(`${note.x},192,NaN,128,0,${note.time}:0:0:0:0:`);
        else
            output_notes.push(`${note.x},192,${note.time},1,0,0:0:0:0:`);
	}

    output_speeds = [];
    for (let speed of speeds) {
        // soft hitsounds + 0% volume + no measure lines
        output_speeds.push(`${speed.time},${speed.value == 0 ? zero : 60000 / (bpm * speed.value)},${meter},2,0,0,1,8`);
	}

    return [output_notes.join('\n'), output_speeds.join('\n')];
}

// wrapper function
function convert_negative_sv(raw, bpm, diffName, framerate = 20, render_distance = 700, render_limit = 4, start_time = 0, extra_speeds = false) {
    // preserve the metadata
    let metadata = raw.split('[TimingPoints]')[0];
    // ...except for the diff name
    metadata = metadata.replace(new RegExp(/\nVersion:.*\n/), `\nVersion: ${diffName}\n`);

    // save the original notes so we can add them back in later
    let original_notes = raw.split('[HitObjects]')[1];

    // parse the input
    let input = parse_mania(raw, bpm, extra_speeds);
    let modified_input = input;

    if (start_time > 0) {
        // cut the map for testing purposes
        modified_input = [
			input[0].filter(note => note.time - start_time > 0)
					.map(note => new Note(note.time - start_time, note.x, note.fake)),
			input[1].filter(speed => speed.time - start_time > 0)
					.map(speed => new Speed(speed.time - start_time, speed.value))
        ]

        // also need to cut original notes
        let raw_notes = raw.split('[HitObjects]')[1].split('\n');
        original_notes = [];
		let line_match;
        for (let line of raw_notes) {
            // single notes
            line_match = (new RegExp(/^([\d\.]+,[\d\.]+,)(\d+)(,\d+,\d+,\d+:\d+:\d+:\d+:)$/)).exec(line);
            if (line_match) {
                if (parseInt(line_match[2]) - start_time > 0) {
                    original_notes.push(
						line_match[1] + 
						(parseInt(line_match[2]) - start_time) + 
						line_match[3]
					);
                    continue;
				}
			}

            // lns
            line_match = (new RegExp(/^([\d\.]+,[\d\.]+,)(\d+)(,\d+,\d+,)(\d+)(:\d+:\d+:\d+:\d+:)$/)).exec(line);
            if (line_match) {
                if (parseInt(line_match[2]) - start_time > 0) {
                    original_notes.push(
						line_match[1] + 
						(parseInt(line_match[2]) - start_time) + 
						line_match[3] + 
						(parseInt(line_match[4]) - start_time) + 
						line_match[5]
					);
				}
			}
		}
        original_notes = original_notes.join('\n');
	}

    // hit me!
    let output = dance(modified_input[0], modified_input[1], framerate, render_distance, render_limit);

    // format the output
    let formatted = format_mania(output[0], output[1], bpm);

    // remember to add the metadata and original notes back in!
    return `${metadata}\n\n[TimingPoints]\n${formatted[1]}\n\n[HitObjects]\n${formatted[0].concat(original_notes)}`;
}
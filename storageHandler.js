import { paths } from './pdfHandler.js';

export function saveJSON() {
    let data = {
        paths: paths
    };
    let json = JSON.stringify(data);
    let blob = new Blob([json], { type: 'application/json' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = (new Date()) + '.json';
    a.click();
}

export function loadJSON() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', function(event) {
        let file = event.target.files[0];
        let reader = new FileReader();
        reader.onload = function() {
            let data = JSON.parse(reader.result);
            paths = data.paths;
            renderPage(1);
            // ボタンの有効/無効を設定
            updateButtons();
        };
        reader.readAsText(file);
    });
    input.click();
}

export function saveAnnotation(_uuid, _paths) {
    const data = JSON.stringify(_paths);
    fetch('api.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            uuid: _uuid,
            data: data,
        }),
    }).then(response => response.json()).then(data => {
        if (data.status !== 'success') {
            console.error('Failed to save annotation');
        }
    }).catch(error => {
        console.error('Error:', error);
    });
}

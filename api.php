<?php
header('Content-Type: application/json');

$targetDir = "files/";

function generateUUID() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (isset($input['uuid']) && isset($input['data'])) {
        $uuid = $input['uuid'];
        $data = $input['data'];
        $jsonFile = $targetDir . $uuid . '.json';
        if (file_put_contents($jsonFile, $data) !== false) {
            echo json_encode(['status' => 'success']);
        } else {
            echo json_encode(['status' => 'error', 'message' => 'Failed to save data']);
        }
    } elseif (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $uuid = generateUUID();
        $targetFile = $targetDir . $uuid . '.pdf';
        if (move_uploaded_file($_FILES['file']['tmp_name'], $targetFile)) {
            echo json_encode(['uuid' => $uuid]);
        } else {
            echo json_encode(['status' => 'error', 'message' => 'Failed to upload file']);
        }
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Invalid request or file upload error']);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['uuid'])) {
    $uuid = $_GET['uuid'];
    $pdfFile = $targetDir . $uuid . '.pdf';
    $jsonFile = $targetDir . $uuid . '.json';

    if (file_exists($pdfFile) && file_exists($jsonFile)) {
        $jsonData = file_get_contents($jsonFile);
        echo json_encode(['pdf' => $pdfFile, 'annotations' => $jsonData]);
    } else {
        echo json_encode(['status' => 'error', 'message' => 'File not found']);
    }
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request']);
}
?>

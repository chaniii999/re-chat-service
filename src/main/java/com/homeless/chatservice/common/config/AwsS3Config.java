package com.homeless.chatservice.common.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.net.URL;
import java.net.URLDecoder;

// AWS에 연결해서 S3에 관련된 서비스를 실행하는 전용 객체
@Component
@Slf4j
public class AwsS3Config {

    // S3 버킷을 제어하는 객체
    private S3Client s3Client;

    @Value("${aws.s3.access-key}")
    private String accessKey;
    @Value("${aws.s3.secret-key}")
    private String secretKey;
    @Value("${aws.s3.region}")
    private String region;
    @Value("${aws.s3.bucket}")
    private String bucketName;

    // S3에 연결해서 인증을 처리하는 로직
    @PostConstruct // 클래스를 기반으로 객체가 생성될 때 1번만 실행되는 아노테이션
    private void initializeAmazonS3Client() {
        AwsBasicCredentials credentials = AwsBasicCredentials.create(accessKey, secretKey);

        this.s3Client = S3Client.builder()
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(credentials))
                .build();
        
        log.info("AWS S3 client initialized for region: {}", region);
    }

    /**
     * 버킷에 파일을 업로드하고, 업로드한 버킷의 url 정보를 리턴
     *
     * @param uploadFile - 업로드 할 파일의 실제 raw 데이터
     * @param fileName   - 업로드 할 파일명
     * @return - 버킷에 업로드 된 버킷 경로(url)
     */
    public String uploadFile(byte[] uploadFile, String fileName) {
        try {
            PutObjectRequest request = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(fileName)
                    .build();

            s3Client.putObject(request, RequestBody.fromBytes(uploadFile));
            
            return String.format("https://%s.s3.%s.amazonaws.com/%s", 
                    bucketName, region, fileName);
        } catch (Exception e) {
            log.error("Error uploading file to S3: {}", e.getMessage());
            throw new RuntimeException("Failed to upload file to S3", e);
        }
    }

    // 버킷에 업로드 된 이미지를 삭제하는 로직
    // 버킷에 오브젝트를 지우기 위해서는 키값을 줘야 하는데
    // 우리가 가지고 있는 건 키가 아니라 url입니다.

    // 우리가 가진 데이터: https://orderservice-prod-img8917.s3.ap-northeast-2.amazonaws.com/74b59c79-d5da-4d05-b99a-557f00b4da07_fileName.gif
    // 가공 결과: 74b59c79-d5da-4d05-b99a-557f00b4da07_fileName.gif
    public void deleteFile(String fileUrl) {
        try {
            URL url = new URL(fileUrl);
            String path = url.getPath();
            String fileName = URLDecoder.decode(path.substring(1), "UTF-8");

            DeleteObjectRequest request = DeleteObjectRequest.builder()
                    .bucket(bucketName)
                    .key(fileName)
                    .build();

            s3Client.deleteObject(request);
            log.info("Successfully deleted file: {}", fileName);
        } catch (Exception e) {
            log.error("Error deleting file from S3: {}", e.getMessage());
            throw new RuntimeException("Failed to delete file from S3", e);
        }
    }
}
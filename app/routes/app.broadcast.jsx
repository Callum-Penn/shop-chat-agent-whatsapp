import { useState, useMemo, useCallback, useEffect } from "react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Badge,
  Frame,
  Toast,
  DropZone,
  Thumbnail,
  Stack,
} from "@shopify/polaris";

export default function BroadcastCenter() {
  const [message, setMessage] = useState("");
  const [heading, setHeading] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [websiteChecked, setWebsiteChecked] = useState(true);
  const [whatsappChecked, setWhatsappChecked] = useState(false);
  const [whatsappUserCount, setWhatsappUserCount] = useState(0);
  const [webUserCount, setWebUserCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSend = useMemo(() => {
    const hasChannel = websiteChecked || whatsappChecked;
    const hasWhatsAppAudience = !whatsappChecked || whatsappUserCount > 0;
    const hasWebAudience = !websiteChecked || webUserCount > 0;
    const hasContent = message.trim().length > 0 || heading.trim().length > 0 || imageFile;
    return hasChannel && hasWhatsAppAudience && hasWebAudience && hasContent;
  }, [websiteChecked, whatsappChecked, whatsappUserCount, webUserCount, message, heading, imageFile]);

  const handleImageChange = useCallback((files) => {
    const file = files[0];
    if (file) {
      // Validate file type (JPG or PNG only)
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        alert('Images must be JPG or PNG format');
        return;
      }
      
      // Validate file size (5MB max for WhatsApp)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB for WhatsApp compatibility');
        return;
      }
      
      // Validate image dimensions
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          if (img.width > 640 || img.height > 640) {
            alert(`Image dimensions must not exceed 640px in width or height. Current size: ${img.width}x${img.height}px`);
            return;
          }
          setImageFile(file);
          setImagePreview(e.target.result);
        };
        img.onerror = () => {
          alert('Failed to load image. Please try a different file.');
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        alert('Failed to read image file. Please try again.');
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadLogs = async () => {
      try {
        const res = await fetch("/api/broadcast/log");
        if (!res.ok) throw new Error("Failed to load logs");
        const data = await res.json();
        if (isMounted) setLogs(Array.isArray(data) ? data : []);
      } catch (e) {
        // ignore for POC
      } finally {
        if (isMounted) setLoadingLogs(false);
      }
    };

    loadLogs();
    
    // Load user counts
    const loadWhatsAppUserCount = async () => {
      try {
        const res = await fetch("/api/broadcast/whatsapp-users");
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setWhatsappUserCount(data.count || 0);
        }
      } catch (e) {
        // ignore for POC
      }
    };

    const loadWebUserCount = async () => {
      try {
        const res = await fetch("/api/broadcast/web-users");
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setWebUserCount(data.count || 0);
        }
      } catch (e) {
        // ignore for POC
      }
    };
    
    loadWhatsAppUserCount();
    loadWebUserCount();
    
    return () => { 
      isMounted = false; 
    };
  }, []);

  const handleSend = useCallback(async () => {
    try {
      const payload = {
        message: message.trim(),
        heading: heading.trim(),
        channels: { website: websiteChecked, whatsapp: whatsappChecked },
      };
      
      // If there's an image, we'll need to handle it differently
      if (imageFile) {
        // For now, we'll convert to base64 and send
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(imageFile);
        });
        payload.image = base64;
        payload.imageName = imageFile.name;
        payload.imageType = imageFile.type;
      }
      const res = await fetch("/api/broadcast/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to log broadcast");
      const entry = await res.json();
      setLogs((prev) => [entry, ...prev]);
      setShowToast(true);
      
      // Refresh logs after a short delay to show updated status
      if (whatsappChecked) {
        setTimeout(() => {
          handleRefresh();
        }, 3000); // Wait 3 seconds for WhatsApp processing to complete
      }
    } catch (e) {
      // ignore for POC
    }
  }, [message, heading, websiteChecked, whatsappChecked, imageFile]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Load logs
      const res = await fetch("/api/broadcast/log");
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
      }
      
      // Load user counts
      const userRes = await fetch("/api/broadcast/whatsapp-users");
      if (userRes.ok) {
        const userData = await userRes.json();
        setWhatsappUserCount(userData.count || 0);
      }

      const webUserRes = await fetch("/api/broadcast/web-users");
      if (webUserRes.ok) {
        const webUserData = await webUserRes.json();
        setWebUserCount(webUserData.count || 0);
      }
    } catch (e) {
      // ignore for POC
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <Page>
      <TitleBar title="Broadcast Center (POC)" />
      <Frame>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Compose message</Text>
                
                <TextField
                  label="Heading (optional)"
                  value={heading}
                  onChange={setHeading}
                  autoComplete="off"
                  placeholder="Enter a bold heading for your message…"
                  helpText="This will appear in bold for WhatsApp messages"
                />
                
                <TextField
                  label="Message"
                  value={message}
                  onChange={setMessage}
                  multiline={6}
                  autoComplete="off"
                  placeholder="Write your announcement or promotion…"
                  helpText="You can include links by typing a URL (e.g., https://example.com) or using Markdown format: [Link text](https://example.com). Links work on both web chat and WhatsApp."
                />
                
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Image (optional)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Images must be JPG or PNG format and must not exceed 640px in width or height.
                  </Text>
                  
                  {!imageFile ? (
                    <DropZone
                      accept="image/jpeg,image/png"
                      type="image"
                      onDrop={handleImageChange}
                      allowMultiple={false}
                    >
                      <DropZone.FileUpload />
                      <Text as="p" variant="bodySm" tone="subdued">
                        Square images work best. Max size: 5MB.
                      </Text>
                    </DropZone>
                  ) : (
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <Text as="h4" variant="headingSm">
                            Selected Image
                          </Text>
                          <Button size="slim" onClick={removeImage}>
                            Remove
                          </Button>
                        </InlineStack>
                        
                        <InlineStack gap="300" align="start">
                          <Thumbnail
                            source={imagePreview}
                            alt="Image preview"
                            size="large"
                          />
                          <BlockStack gap="100">
                            <Text as="p" variant="bodyMd">
                              {imageFile.name}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
                <InlineStack gap="400" wrap={false} align="start">
                  <Checkbox
                    label="Website"
                    checked={websiteChecked}
                    onChange={setWebsiteChecked}
                  />
                  <Checkbox
                    label="WhatsApp"
                    checked={whatsappChecked}
                    onChange={setWhatsappChecked}
                  />
                </InlineStack>

                {whatsappChecked && (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        📱 WhatsApp will be sent to <strong>{whatsappUserCount}</strong> users from your database
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        This includes all customers who have previously messaged you via WhatsApp
                      </Text>
                    </BlockStack>
                  </Card>
                )}

                {websiteChecked && (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        💬 Website chat will be sent to <strong>{webUserCount}</strong> users from your database
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        This includes all customers who have used the web chat feature
                      </Text>
                    </BlockStack>
                  </Card>
                )}

                <InlineStack gap="300" align="end">
                  <Button variant="secondary" onClick={() => {
                    setMessage("");
                    setHeading("");
                    setImageFile(null);
                    setImagePreview(null);
                    setWebsiteChecked(true);
                    setWhatsappChecked(false);
                  }}>
                    Clear
                  </Button>
                  <Button variant="primary" disabled={!canSend} onClick={handleSend}>
                    Send Broadcast (POC)
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Recent sends</Text>
                  <Button 
                    variant="secondary" 
                    size="slim" 
                    onClick={handleRefresh}
                    loading={refreshing}
                  >
                    Refresh
                  </Button>
                </InlineStack>
                {loadingLogs ? (
                  <Text as="p" variant="bodySm" tone="subdued">Loading…</Text>
                ) : logs.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No broadcasts yet.</Text>
                ) : (
                  <BlockStack gap="200">
                    {logs.slice(0, 10).map((entry) => (
                      <Card key={entry.id}>
                        <BlockStack gap="200">
                          <InlineStack gap="200" align="space-between">
                            <InlineStack gap="200">
                              {entry?.channels?.website && <Badge tone="success">Website</Badge>}
                              {entry?.channels?.whatsapp && <Badge tone="attention">WhatsApp</Badge>}
                              {entry?.status && (
                                <Badge tone={
                                  entry.status === 'completed' ? 'success' :
                                  entry.status === 'failed' ? 'critical' :
                                  entry.status === 'partial' ? 'warning' : 'info'
                                }>
                                  {entry.status === 'completed' ? 'Completed' :
                                   entry.status === 'failed' ? 'Failed' :
                                   entry.status === 'partial' ? 'Partial' : 'Processing'}
                                </Badge>
                              )}
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="subdued">{new Date(entry.createdAt).toLocaleString()}</Text>
                          </InlineStack>
                          <Text as="p" variant="bodyMd">{entry.message}</Text>
                          {entry?.channels?.whatsapp && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              WhatsApp: {entry.results?.whatsapp?.sent || 0} sent, {entry.results?.whatsapp?.failed || 0} failed
                              {entry.results?.whatsapp?.errors?.length > 0 && (
                                <span> ({entry.results.whatsapp.errors.length} errors)</span>
                              )}
                            </Text>
                          )}
                          {entry?.channels?.website && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Website: {entry.results?.website?.sent || 0} sent, {entry.results?.website?.failed || 0} failed
                            </Text>
                          )}
                        </BlockStack>
                      </Card>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Preview</Text>
                <InlineStack gap="200">
                  {websiteChecked && <Badge tone="success">Website</Badge>}
                  {whatsappChecked && <Badge tone="attention">WhatsApp</Badge>}
                </InlineStack>
                <Card>
                  <BlockStack gap="200">
                    {imagePreview && (
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        style={{ 
                          maxWidth: '100%', 
                          maxHeight: '200px', 
                          objectFit: 'cover',
                          borderRadius: '8px',
                          border: '1px solid #e1e3e5'
                        }} 
                      />
                    )}
                    {heading?.trim() && (
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        {heading}
                      </Text>
                    )}
                    <Text as="p" variant="bodyMd">
                      {message?.trim() ? message : "Your message preview will appear here."}
                    </Text>
                  </BlockStack>
                </Card>
                {websiteChecked && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Website recipients: {webUserCount} users from database
                  </Text>
                )}
                {whatsappChecked && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    WhatsApp recipients: {whatsappUserCount} users from database
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {showToast && (
          <Toast
            content="Broadcast sent successfully!"
            onDismiss={() => setShowToast(false)}
            duration={3000}
          />
        )}
      </Frame>
    </Page>
  );
}



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
} from "@shopify/polaris";

export default function BroadcastCenter() {
  const [message, setMessage] = useState("");
  const [websiteChecked, setWebsiteChecked] = useState(true);
  const [whatsappChecked, setWhatsappChecked] = useState(false);
  const [whatsappUserCount, setWhatsappUserCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSend = useMemo(() => {
    const hasChannel = websiteChecked || whatsappChecked;
    const hasWhatsAppAudience = !whatsappChecked || whatsappUserCount > 0;
    return hasChannel && hasWhatsAppAudience && message.trim().length > 0;
  }, [websiteChecked, whatsappChecked, whatsappUserCount, message]);

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
    
    // Load WhatsApp user count
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
    
    loadWhatsAppUserCount();
    
    return () => { 
      isMounted = false; 
    };
  }, []);

  const handleSend = useCallback(async () => {
    try {
      const payload = {
        message: message.trim(),
        channels: { website: websiteChecked, whatsapp: whatsappChecked },
      };
      const res = await fetch("/api/broadcast/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to log broadcast");
      const entry = await res.json();
      setLogs((prev) => [entry, ...prev]);
      setShowToast(true);
    } catch (e) {
      // ignore for POC
    }
  }, [message, websiteChecked, whatsappChecked]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Load logs
      const res = await fetch("/api/broadcast/log");
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
      }
      
      // Load WhatsApp user count
      const userRes = await fetch("/api/broadcast/whatsapp-users");
      if (userRes.ok) {
        const userData = await userRes.json();
        setWhatsappUserCount(userData.count || 0);
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
                  label="Message"
                  value={message}
                  onChange={setMessage}
                  multiline={6}
                  autoComplete="off"
                  placeholder="Write your announcement or promotion…"
                />
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

                <InlineStack gap="300" align="end">
                  <Button variant="secondary" onClick={() => {
                    setMessage("");
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
                    <Text as="p" variant="bodyMd">
                      {message?.trim() ? message : "Your message preview will appear here."}
                    </Text>
                  </BlockStack>
                </Card>
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



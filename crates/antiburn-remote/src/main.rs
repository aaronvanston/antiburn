use antiburn_remote::{Request, collector};
use std::io::{Read, Write};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("antiburn-remote: {error}");
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(
        args.as_slice() == ["stdio"] || (args.len() == 2 && args[0] == "ssh"),
        "Usage: antiburn-remote stdio | ssh HOST (one JSON request on stdin)"
    );
    let mut bytes = Vec::new();
    std::io::stdin().take(8193).read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 8192, "Request exceeds 8 KiB");
    let request: Request = serde_json::from_slice(&bytes)?;
    request.validate()?;
    if args[0] == "ssh" {
        anyhow::ensure!(
            !matches!(request, Request::Export { .. }),
            "Binary export requires the desktop sync client or stdio mode"
        );
        let response = antiburn_remote::transport::request(&args[1], &request).await?;
        std::io::stdout().write_all(&response)?;
        return Ok(());
    }

    if let Request::Export {
        agent,
        session_id,
        known,
        ..
    } = &request
    {
        return antiburn_remote::export::write_bundle(
            agent,
            session_id,
            known.as_deref(),
            &mut std::io::stdout(),
        )
        .await;
    }
    let response = match request {
        Request::Export { .. } => unreachable!(),
        Request::List { .. } => serde_json::to_vec(&collector::list().await)?,
        Request::Analyze {
            agent, session_id, ..
        } => serde_json::to_vec(&collector::analyze(&agent, &session_id).await?)?,
    };
    anyhow::ensure!(
        response.len() as u64 <= antiburn_remote::MAX_RESPONSE_BYTES,
        "Response exceeds limit"
    );
    std::io::stdout().write_all(&response)?;
    Ok(())
}
